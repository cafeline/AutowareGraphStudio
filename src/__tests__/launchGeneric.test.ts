import { describe, expect, it } from "vitest";
import { conditionArgNames, evaluateCondition, isElementActive } from "../lib/launchConditions";
import { buildLaunchOverrideArgs, parseLaunchArgSpecs } from "../lib/launchArgs";
import { buildRuntimeGraph, parseStaticGraph } from "../lib/parser";
import { discoverSwitchArgs } from "../lib/launchSwitches";

const noPackages = {};

const conditionalFiles = {
  "/ws/pkg/package.xml": "<package><name>pkg</name></package>",
  "/ws/pkg/launch/entry.launch.xml": `
    <launch>
      <arg name="launch_loc" default="true"/>
      <arg name="pose_source" default="ndt"/>
      <group if="$(var launch_loc)">
        <node pkg="pkg" exec="loc" name="loc_node"/>
      </group>
      <group if="$(eval &quot;'$(var pose_source)'=='ndt'&quot;)">
        <node pkg="pkg" exec="ndt" name="ndt_node"/>
      </group>
      <group if="$(eval &quot;'$(var pose_source)'=='yabloc'&quot;)">
        <node pkg="pkg" exec="yabloc" name="yabloc_node"/>
      </group>
    </launch>
  `
};

describe("launch condition evaluation", () => {
  it("evaluates boolean literals", () => {
    expect(evaluateCondition("true", {}, noPackages)).toEqual({ value: true, evaluated: true });
    expect(evaluateCondition("false", {}, noPackages)).toEqual({ value: false, evaluated: true });
    expect(evaluateCondition("1", {}, noPackages)).toEqual({ value: true, evaluated: true });
    expect(evaluateCondition("0", {}, noPackages)).toEqual({ value: false, evaluated: true });
  });

  it("resolves a var to a boolean", () => {
    expect(evaluateCondition("$(var launch_localization)", { launch_localization: "false" }, noPackages)).toEqual({
      value: false,
      evaluated: true
    });
    expect(evaluateCondition("$(var launch_localization)", { launch_localization: "true" }, noPackages)).toEqual({
      value: true,
      evaluated: true
    });
  });

  it("evaluates string equality inside $(eval)", () => {
    expect(
      evaluateCondition("$(eval \"'$(var pose_source)'=='ndt'\")", { pose_source: "ndt" }, noPackages).value
    ).toBe(true);
    expect(
      evaluateCondition("$(eval \"'$(var pose_source)'=='ndt'\")", { pose_source: "yabloc" }, noPackages).value
    ).toBe(false);
  });

  it("evaluates membership and boolean operators", () => {
    expect(evaluateCondition("$(eval \"'ndt' in '$(var pose_source)'\")", { pose_source: "ndt_yabloc" }, noPackages).value).toBe(true);
    expect(evaluateCondition("$(eval \"'ndt' in '$(var pose_source)'\")", { pose_source: "yabloc" }, noPackages).value).toBe(false);
    expect(
      evaluateCondition("$(eval \"'$(var a)'=='x' and '$(var b)'=='y'\")", { a: "x", b: "y" }, noPackages).value
    ).toBe(true);
    expect(evaluateCondition("$(eval \"not ('$(var a)'=='x')\")", { a: "x" }, noPackages).value).toBe(false);
    expect(evaluateCondition("$(eval \"'a' not in '$(var v)'\")", { v: "bcd" }, noPackages).value).toBe(true);
  });

  it("fails open on unsupported expressions", () => {
    const result = evaluateCondition("$(eval \"len('$(var x)') > 0\")", { x: "abc" }, noPackages);
    expect(result.evaluated).toBe(false);
  });

  it("decides element activeness with fail-open semantics", () => {
    expect(isElementActive({ if: "$(var on)" }, { on: "true" }, noPackages)).toBe(true);
    expect(isElementActive({ if: "$(var on)" }, { on: "false" }, noPackages)).toBe(false);
    expect(isElementActive({ unless: "$(var off)" }, { off: "true" }, noPackages)).toBe(false);
    expect(isElementActive({ unless: "$(var off)" }, { off: "false" }, noPackages)).toBe(true);
    expect(isElementActive({}, {}, noPackages)).toBe(true);
    // unsupported -> fail open -> active
    expect(isElementActive({ if: "$(eval \"foo(1)\")" }, {}, noPackages)).toBe(true);
  });

  it("extracts the var names referenced by a condition", () => {
    expect(conditionArgNames("$(eval \"'$(var pose_source)'=='ndt'\")")).toEqual(["pose_source"]);
    expect(conditionArgNames("$(var launch_localization)")).toEqual(["launch_localization"]);
    expect(conditionArgNames("true")).toEqual([]);
  });
});

describe("parser prunes inactive branches and records provenance", () => {
  it("drops nodes whose condition is false and keeps the launched ones with gatedBy", () => {
    const graph = parseStaticGraph(conditionalFiles, "/ws/pkg/launch/entry.launch.xml", {
      launch_loc: "false",
      pose_source: "ndt"
    });
    const names = graph.nodes.map((node) => node.name);
    expect(names).toContain("ndt_node");
    expect(names).not.toContain("loc_node");
    expect(names).not.toContain("yabloc_node");
    expect(graph.nodes.find((node) => node.name === "ndt_node")?.gatedBy).toEqual(["pose_source"]);
    const entry = graph.launchGraph.launches.find((launch) => launch.path === "/ws/pkg/launch/entry.launch.xml");
    expect(entry?.nodeNames).toEqual(["ndt_node"]);
  });

  it("follows a different active branch when the arg changes", () => {
    const graph = parseStaticGraph(conditionalFiles, "/ws/pkg/launch/entry.launch.xml", {
      launch_loc: "true",
      pose_source: "yabloc"
    });
    const names = graph.nodes.map((node) => node.name);
    expect(names).toContain("loc_node");
    expect(names).toContain("yabloc_node");
    expect(names).not.toContain("ndt_node");
  });

  it("fails open and keeps nodes when a condition var is undefined", () => {
    const files = {
      "/ws/pkg/package.xml": "<package><name>pkg</name></package>",
      "/ws/pkg/launch/entry.launch.xml": `
        <launch>
          <group if="$(var never_defined)">
            <node pkg="pkg" exec="x" name="keep_me"/>
          </group>
        </launch>
      `
    };
    const graph = parseStaticGraph(files, "/ws/pkg/launch/entry.launch.xml", {});
    expect(graph.nodes.map((node) => node.name)).toContain("keep_me");
  });
});

describe("composable node parsing", () => {
  const files = {
    "/ws/pkg/package.xml": "<package><name>pkg</name></package>",
    "/ws/pkg/launch/c.launch.xml": `
      <launch>
        <node_container pkg="rclcpp_components" exec="component_container" name="control_container" namespace="">
          <composable_node pkg="autoware_shift_decider" plugin="autoware::shift_decider::ShiftDecider" name="shift_decider">
            <remap from="~/input/x" to="/in"/>
            <remap from="~/output/y" to="/out"/>
          </composable_node>
          <composable_node pkg="autoware_off" plugin="ns::Off" name="off_node" unless="$(var on)"/>
        </node_container>
        <load_composable_node target="/control/control_container">
          <composable_node pkg="autoware_vehicle_cmd_gate" plugin="ns::VehicleCmdGate" name="vehicle_cmd_gate"/>
        </load_composable_node>
      </launch>
    `
  };

  it("parses node_container, composable_node and load_composable_node entries", () => {
    const graph = parseStaticGraph(files, "/ws/pkg/launch/c.launch.xml", { on: "true" });
    const names = graph.nodes.map((node) => node.name);
    expect(names).toContain("control_container");
    expect(names).toContain("shift_decider");
    expect(names).toContain("vehicle_cmd_gate");

    const shift = graph.nodes.find((node) => node.name === "shift_decider");
    expect(shift?.packageName).toBe("autoware_shift_decider");
    expect(shift?.executable).toBe("autoware::shift_decider::ShiftDecider");
    expect(shift?.outputs.some((pin) => pin.topicName === "/out")).toBe(true);
    expect(shift?.inputs.some((pin) => pin.topicName === "/in")).toBe(true);
    expect(shift?.restartTarget).toMatchObject({
      kind: "component",
      nodeName: "shift_decider",
      restartName: "control_container",
      containerName: "control_container",
      plugin: "autoware::shift_decider::ShiftDecider"
    });
    expect(graph.nodes.find((node) => node.name === "vehicle_cmd_gate")?.restartTarget).toMatchObject({
      kind: "component",
      nodeName: "/control/vehicle_cmd_gate",
      restartName: "/control/control_container",
      containerName: "/control/control_container",
      plugin: "ns::VehicleCmdGate"
    });
  });

  it("applies if/unless conditions to composable nodes", () => {
    // off_node has unless="$(var on)": excluded when on=true, included when on=false.
    const excluded = parseStaticGraph(files, "/ws/pkg/launch/c.launch.xml", { on: "true" });
    expect(excluded.nodes.map((node) => node.name)).not.toContain("off_node");
    const included = parseStaticGraph(files, "/ws/pkg/launch/c.launch.xml", { on: "false" });
    expect(included.nodes.map((node) => node.name)).toContain("off_node");
  });
});

describe("ROS namespace resolution", () => {
  it("applies push-ros-namespace across included launch files and resolves relative remap topics", () => {
    const files = {
      "/ws/root_pkg/package.xml": "<package><name>root_pkg</name></package>",
      "/ws/child_pkg/package.xml": "<package><name>child_pkg</name></package>",
      "/ws/leaf_pkg/package.xml": "<package><name>leaf_pkg</name></package>",
      "/ws/root_pkg/launch/entry.launch.xml": `
        <launch>
          <group>
            <push-ros-namespace namespace="planning"/>
            <include file="$(find-pkg-share child_pkg)/launch/child.launch.xml"/>
          </group>
        </launch>
      `,
      "/ws/child_pkg/launch/child.launch.xml": `
        <launch>
          <group>
            <push-ros-namespace namespace="scenario_planning"/>
            <include file="$(find-pkg-share leaf_pkg)/launch/leaf.launch.xml"/>
          </group>
        </launch>
      `,
      "/ws/leaf_pkg/launch/leaf.launch.xml": `
        <launch>
          <group>
            <push-ros-namespace namespace="lane_driving"/>
            <group>
              <push-ros-namespace namespace="behavior_planning"/>
              <node_container pkg="rclcpp_components" exec="component_container" name="behavior_planning_container" namespace="">
                <composable_node pkg="leaf_pkg" plugin="ns::BehaviorPath" name="behavior_path_planner" namespace="">
                  <remap from="~/output/path" to="path_with_lane_id"/>
                </composable_node>
                <composable_node pkg="leaf_pkg" plugin="ns::BehaviorVelocity" name="behavior_velocity_planner" namespace="">
                  <remap from="~/input/path" to="path_with_lane_id"/>
                  <remap from="~/output/path" to="path"/>
                </composable_node>
              </node_container>
            </group>
          </group>
        </launch>
      `
    };

    const graph = parseStaticGraph(files, "/ws/root_pkg/launch/entry.launch.xml", {});
    const velocity = graph.nodes.find((node) => node.name === "behavior_velocity_planner");

    expect(velocity?.inputs.map((pin) => pin.topicName)).toContain(
      "/planning/scenario_planning/lane_driving/behavior_planning/path_with_lane_id"
    );
    expect(velocity?.outputs.map((pin) => pin.topicName)).toContain(
      "/planning/scenario_planning/lane_driving/behavior_planning/path"
    );
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source: "/planning/scenario_planning/lane_driving/behavior_planning/behavior_path_planner",
        target: "/planning/scenario_planning/lane_driving/behavior_planning/behavior_velocity_planner",
        topicName: "/planning/scenario_planning/lane_driving/behavior_planning/path_with_lane_id"
      })
    ]);
  });
});

describe("runtime graph from a resolved dump", () => {
  it("builds a complete graph from the running node list with topic edges", () => {
    const graph = buildRuntimeGraph({
      nodes: [
        {
          name: "/control/control_container",
          publishers: { "/control/command/control_cmd": "autoware_control_msgs/msg/Control" },
          subscribers: {}
        },
        {
          name: "/vehicle/raw_vehicle_cmd_converter",
          publishers: {},
          subscribers: { "/control/command/control_cmd": "autoware_control_msgs/msg/Control" }
        }
      ]
    });

    expect(graph.nodes.map((node) => node.name)).toEqual([
      "/control/control_container",
      "/vehicle/raw_vehicle_cmd_converter"
    ]);
    expect(graph.nodes[0].outputs[0].topicName).toBe("/control/command/control_cmd");
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: "/control/control_container",
      target: "/vehicle/raw_vehicle_cmd_converter",
      dataType: "autoware_control_msgs/msg/Control"
    });
  });
});

describe("switch auto-discovery", () => {
  const files = {
    "/ws/a.launch.xml": `
      <launch>
        <arg name="controller" default="" description="control controller override. option: autoware_pure_pursuit"/>
        <arg name="pose_source" default="ndt"/>
        <arg name="map_path"/>
        <arg name="localization_sim_mode" default="api" description="Options are 'none', 'api' or 'pose_twist_estimator'."/>
        <group if="$(eval &quot;'$(var controller)' == 'autoware_pure_pursuit'&quot;)"/>
        <group if="$(eval &quot;'$(var pose_source)'=='ndt'&quot;)"/>
        <group if="$(eval &quot;'$(var pose_source)'=='yabloc'&quot;)"/>
      </launch>
    `
  };

  it("discovers multi-value selector args from conditions and descriptions", () => {
    const switches = discoverSwitchArgs(files);
    const byName = Object.fromEntries(switches.map((item) => [item.name, item]));

    expect([...byName.pose_source.candidates].sort()).toEqual(["ndt", "yabloc"]);
    expect(byName.controller.candidates).toContain("");
    expect(byName.controller.candidates).toContain("autoware_pure_pursuit");
    expect([...byName.localization_sim_mode.candidates].sort()).toEqual(["api", "none", "pose_twist_estimator"]);
  });

  it("ignores args that do not offer a choice", () => {
    const switches = discoverSwitchArgs(files);
    expect(switches.find((item) => item.name === "map_path")).toBeUndefined();
  });
});

describe("launch arg serialization", () => {
  it("uses text inputs for default-only args so map files can be typed", () => {
    const specs = parseLaunchArgSpecs(`
      <launch>
        <arg name="map_path"/>
        <arg name="pointcloud_map_file" default="pointcloud_map.pcd"/>
        <arg name="launch_dummy_doors" default="true"/>
      </launch>
    `);
    const byName = Object.fromEntries(specs.map((item) => [item.name, item]));

    expect(byName.map_path.inputKind).toBe("text");
    expect(byName.pointcloud_map_file.inputKind).toBe("text");
    expect(byName.launch_dummy_doors.inputKind).toBe("select");
  });

  it("keeps required and changed args but omits unchanged launch defaults", () => {
    const specs = parseLaunchArgSpecs(`
      <launch>
        <arg name="map_path"/>
        <arg name="lanelet2_map_file" default="lanelet2_map.osm"/>
        <arg name="pointcloud_map_file" default="pointcloud_map.pcd"/>
        <arg name="controller" default=""/>
      </launch>
    `);

    expect(buildLaunchOverrideArgs(specs, {
      map_path: "/home/ryofunai/room206_map_data_wide_lane",
      lanelet2_map_file: "lanelet2_map.osm",
      pointcloud_map_file: "pointcloud",
      controller: "autoware_pure_pursuit"
    })).toEqual({
      map_path: "/home/ryofunai/room206_map_data_wide_lane",
      pointcloud_map_file: "pointcloud",
      controller: "autoware_pure_pursuit"
    });
  });
});

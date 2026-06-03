import { describe, expect, it } from "vitest";
import { buildForkSet } from "../lib/forkChain";
import { parseStaticGraph } from "../lib/parser";
import { emptyComposition, setArgOverride, setNodeDisabled, addComposedNode } from "../lib/composition";

const SOURCE_ROOT = "/ws";
const ENTRY = "/ws/pkg/launch/entry.launch.xml";
const FORKS_DIR = "/over/forks";

const files: Record<string, string> = {
  "/ws/pkg/package.xml": "<package><name>pkg</name></package>",
  "/ws/pkg/launch/entry.launch.xml": `<launch>
  <arg name="vehicle_model" default="palta"/>
  <arg name="controller" default=""/>
  <arg name="map_path"/>
  <include file="$(find-pkg-share pkg)/launch/child.launch.xml">
    <arg name="map_path" value="$(var map_path)"/>
  </include>
</launch>
`,
  "/ws/pkg/launch/child.launch.xml": `<launch>
  <arg name="map_path"/>
  <node pkg="pkg" exec="psim_talker" name="psim_talker">
    <remap from="~/output/state" to="/psim/state"/>
    <param name="gain" value="1.0"/>
  </node>
  <node pkg="pkg" exec="listener" name="listener"/>
</launch>
`
};

function loadGraph(args: Record<string, string> = {}) {
  return parseStaticGraph(files, ENTRY, args);
}

const baseInput = () => ({
  entryLaunch: ENTRY,
  forksDir: FORKS_DIR,
  sourceRoot: SOURCE_ROOT,
  files,
  graph: loadGraph(),
  composition: emptyComposition(),
  paramOverrides: [],
  topicOverrides: [],
  launchArgs: {} as Record<string, string>
});

describe("buildForkSet — selective fork-chain", () => {
  it("when nothing is edited, only the entry is forked and points at the original child", () => {
    const out = buildForkSet(baseInput());
    expect(out.entryForkPath).toBe(`${FORKS_DIR}/pkg/launch/entry.launch.xml`);
    expect(out.forks.map((f) => f.path)).toEqual([`${FORKS_DIR}/pkg/launch/entry.launch.xml`]);
    const entryFork = out.forks[0];
    // include still points to the original (no edit touched the child)
    expect(entryFork.content).toContain(`<include file="$(find-pkg-share pkg)/launch/child.launch.xml">`);
  });

  it("disabling a node forks the file declaring it and the entry, rewriting include to the fork", () => {
    const out = buildForkSet({
      ...baseInput(),
      composition: setNodeDisabled(emptyComposition(), "listener", true)
    });
    const paths = out.forks.map((f) => f.path);
    expect(paths).toContain(`${FORKS_DIR}/pkg/launch/entry.launch.xml`);
    expect(paths).toContain(`${FORKS_DIR}/pkg/launch/child.launch.xml`);

    const childFork = out.forks.find((f) => f.path.endsWith("child.launch.xml"))!;
    // listener block removed; psim_talker preserved
    expect(childFork.content).not.toMatch(/name="listener"/);
    expect(childFork.content).toMatch(/name="psim_talker"/);

    const entryFork = out.forks.find((f) => f.path.endsWith("entry.launch.xml"))!;
    // include rewritten to fork path (absolute)
    expect(entryFork.content).toContain(`<include file="${FORKS_DIR}/pkg/launch/child.launch.xml">`);
    expect(entryFork.content).not.toContain(`$(find-pkg-share pkg)/launch/child.launch.xml`);
  });

  it("param override updates an existing inline <param> in the deepest fork", () => {
    const out = buildForkSet({
      ...baseInput(),
      paramOverrides: [{ nodeName: "psim_talker", key: "gain", value: "2.0" }]
    });
    const childFork = out.forks.find((f) => f.path.endsWith("child.launch.xml"))!;
    expect(childFork.content).toMatch(/<param name="gain" value="2\.0"\/>/);
    // The old 1.0 line should be gone (replaced in place)
    expect(childFork.content).not.toMatch(/value="1\.0"/);
  });

  it("param override forks yaml files and rewrites launch param refs", () => {
    const yamlEntry = "/ws/pkg/launch/yaml_entry.launch.xml";
    const yamlFiles = {
      ...files,
      "/ws/pkg/config/demo.param.yaml": `psim_talker:
  ros__parameters:
    gain: 1.0
    nested:
      threshold: 4
`,
      [yamlEntry]: `<launch>
  <node pkg="pkg" exec="psim_talker" name="psim_talker">
    <param from="$(find-pkg-share pkg)/config/demo.param.yaml"/>
  </node>
</launch>
`
    };
    const graph = parseStaticGraph(yamlFiles, yamlEntry, {});
    const out = buildForkSet({
      ...baseInput(),
      entryLaunch: yamlEntry,
      files: yamlFiles,
      graph,
      paramOverrides: [
        {
          nodeName: "/psim_talker",
          nodeAliases: ["/psim_talker", "psim_talker"],
          key: "nested.threshold",
          value: 9,
          sourceFile: "/ws/pkg/config/demo.param.yaml"
        }
      ]
    });

    const launchFork = out.forks.find((fork) => fork.path.endsWith("yaml_entry.launch.xml"))!;
    expect(launchFork.content).toContain(`from="${FORKS_DIR}/pkg/config/demo.param.yaml"`);
    const yamlFork = out.forks.find((fork) => fork.path.endsWith("demo.param.yaml"))!;
    expect(yamlFork.content).toContain("threshold: 9");
    expect(yamlFork.path.startsWith(`${SOURCE_ROOT}/`)).toBe(false);
  });

  it("rewrites a <param from=$(var X)> ref to the fork when X is declared deep in the tree", () => {
    // Mirrors Autoware: the entry sets common_param_path via a nested $(var ...),
    // and a child node loads it with <param from="$(var common_param_path)">.
    // The yaml override must reach that node, so the ref has to be rewritten to
    // the fork even though common_param_path is not an entry-level arg.
    const e = "/ws/pkg/launch/var_param_entry.launch.xml";
    const child = "/ws/pkg/launch/var_param_child.launch.xml";
    const yamlPath = "/ws/pkg/config/common.param.yaml";
    const varFiles = {
      ...files,
      [yamlPath]: `/**:
  ros__parameters:
    max_vel: 0.28
`,
      [e]: `<launch>
  <include file="$(find-pkg-share pkg)/launch/var_param_child.launch.xml">
    <arg name="config_dir" value="$(find-pkg-share pkg)/config"/>
    <arg name="common_param_path" value="$(var config_dir)/common.param.yaml"/>
  </include>
</launch>
`,
      [child]: `<launch>
  <arg name="config_dir"/>
  <arg name="common_param_path"/>
  <node pkg="pkg" exec="velocity_smoother" name="velocity_smoother">
    <param from="$(var common_param_path)"/>
  </node>
</launch>
`
    };
    const graph = parseStaticGraph(varFiles, e, {});
    const out = buildForkSet({
      ...baseInput(),
      entryLaunch: e,
      files: varFiles,
      graph,
      paramOverrides: [
        {
          nodeName: "velocity_smoother",
          nodeAliases: ["velocity_smoother", "/velocity_smoother"],
          key: "max_vel",
          value: 100,
          sourceFile: yamlPath
        }
      ]
    });

    const yamlFork = out.forks.find((f) => f.path.endsWith("common.param.yaml"))!;
    expect(yamlFork.content).toContain("max_vel: 100");

    // The child must point its <param from> at the forked yaml, not the original.
    const childFork = out.forks.find((f) => f.path.endsWith("var_param_child.launch.xml"))!;
    expect(childFork.content).toContain(`from="${FORKS_DIR}/pkg/config/common.param.yaml"`);
    expect(childFork.content).not.toContain('from="$(var common_param_path)"');
  });

  it("yaml override edits only the target scalar, preserving float types and comments", () => {
    // Whole-file yaml round-tripping turned doubles like 1.0 into ints (1),
    // which breaks ROS 2 type checking. The override must touch only max_vel and
    // leave every other byte — including 1.0 doubles and comments — intact.
    const e = "/ws/pkg/launch/common_entry.launch.xml";
    const yamlPath = "/ws/pkg/config/common.param.yaml";
    const yamlText = `/**:
  ros__parameters:
    max_vel: 0.28         # max velocity limit [m/s]

    # constraints
    normal:
      min_acc: -1.0         # min deceleration
      max_acc: 1.0          # max acceleration
`;
    const varFiles = {
      ...files,
      [yamlPath]: yamlText,
      [e]: `<launch>
  <node pkg="pkg" exec="velocity_smoother" name="velocity_smoother">
    <param from="$(find-pkg-share pkg)/config/common.param.yaml"/>
  </node>
</launch>
`
    };
    const graph = parseStaticGraph(varFiles, e, {});
    const out = buildForkSet({
      ...baseInput(),
      entryLaunch: e,
      files: varFiles,
      graph,
      paramOverrides: [
        { nodeName: "velocity_smoother", nodeAliases: ["velocity_smoother"], key: "max_vel", value: 100, sourceFile: yamlPath }
      ]
    });
    const yamlFork = out.forks.find((f) => f.path.endsWith("common.param.yaml"))!;
    // overridden double stays a double, keeps its comment
    expect(yamlFork.content).toContain("max_vel: 100.0         # max velocity limit [m/s]");
    // untouched doubles and comments are byte-preserved (not collapsed to ints)
    expect(yamlFork.content).toContain("min_acc: -1.0         # min deceleration");
    expect(yamlFork.content).toContain("max_acc: 1.0          # max acceleration");
    expect(yamlFork.content).toContain("    # constraints");
  });

  it("yaml override on an int param stays an int; nested keys resolve by path", () => {
    const e = "/ws/pkg/launch/nested_entry.launch.xml";
    const yamlPath = "/ws/pkg/config/nested.param.yaml";
    const varFiles = {
      ...files,
      [yamlPath]: `velocity_smoother:
  ros__parameters:
    count: 4
    normal:
      max_acc: 1.0
`,
      [e]: `<launch>
  <node pkg="pkg" exec="velocity_smoother" name="velocity_smoother">
    <param from="$(find-pkg-share pkg)/config/nested.param.yaml"/>
  </node>
</launch>
`
    };
    const graph = parseStaticGraph(varFiles, e, {});
    const out = buildForkSet({
      ...baseInput(),
      entryLaunch: e,
      files: varFiles,
      graph,
      paramOverrides: [
        { nodeName: "velocity_smoother", key: "count", value: 7, sourceFile: yamlPath },
        { nodeName: "velocity_smoother", key: "normal.max_acc", value: 2, sourceFile: yamlPath }
      ]
    });
    const yamlFork = out.forks.find((f) => f.path.endsWith("nested.param.yaml"))!;
    expect(yamlFork.content).toContain("count: 7");
    expect(yamlFork.content).not.toContain("count: 7.0");
    // nested double override keeps float type
    expect(yamlFork.content).toContain("max_acc: 2.0");
  });

  it("topic override updates the existing <remap to=\"OLD\"> in the deepest fork", () => {
    const out = buildForkSet({
      ...baseInput(),
      topicOverrides: [
        { nodeName: "psim_talker", pinKind: "output", fromTopic: "/psim/state", toTopic: "/new_topic" }
      ]
    });
    const childFork = out.forks.find((f) => f.path.endsWith("child.launch.xml"))!;
    expect(childFork.content).toMatch(/to="\/new_topic"/);
    expect(childFork.content).not.toMatch(/to="\/psim\/state"/);
  });

  it("Swap (argOverrides) updates the entry fork's <arg default=\"...\">", () => {
    const out = buildForkSet({
      ...baseInput(),
      composition: setArgOverride(emptyComposition(), "vehicle_model", "alpha")
    });
    const entryFork = out.forks.find((f) => f.path.endsWith("entry.launch.xml"))!;
    expect(entryFork.content).toMatch(/<arg name="vehicle_model" default="alpha"\/>/);
    expect(entryFork.content).not.toMatch(/default="palta"/);
  });

  it("bakes launchArgs into the entry fork: adds default to no-default <arg>, overrides existing default", () => {
    const out = buildForkSet({
      ...baseInput(),
      launchArgs: { map_path: "/abs/maps/foo", vehicle_model: "beta" }
    });
    const entryFork = out.forks.find((f) => f.path.endsWith("entry.launch.xml"))!;
    // map_path had no default → default added
    expect(entryFork.content).toMatch(/<arg name="map_path" default="\/abs\/maps\/foo"\/>/);
    // vehicle_model default rewritten from palta → beta
    expect(entryFork.content).toMatch(/<arg name="vehicle_model" default="beta"\/>/);
    expect(entryFork.content).not.toMatch(/default="palta"/);
  });

  it("never adds default= to <arg> inside <include> (those use name+value only)", () => {
    const out = buildForkSet({
      ...baseInput(),
      launchArgs: { map_path: "/abs/maps/foo" }
    });
    const entryFork = out.forks.find((f) => f.path.endsWith("entry.launch.xml"))!;
    // The include's inner arg must remain name+value only, no default attribute injected.
    expect(entryFork.content).toMatch(/<arg name="map_path" value="\$\(var map_path\)"\/>/);
    expect(entryFork.content).not.toMatch(/<arg name="map_path" value="\$\(var map_path\)" default=/);
    expect(entryFork.content).not.toMatch(/<arg name="map_path" default="[^"]*" value=/);
  });

  it("composition.argOverrides wins over launchArgs on the same arg", () => {
    const out = buildForkSet({
      ...baseInput(),
      launchArgs: { vehicle_model: "beta" },
      composition: setArgOverride(emptyComposition(), "vehicle_model", "alpha")
    });
    const entryFork = out.forks.find((f) => f.path.endsWith("entry.launch.xml"))!;
    expect(entryFork.content).toMatch(/<arg name="vehicle_model" default="alpha"\/>/);
    expect(entryFork.content).not.toMatch(/default="beta"/);
  });

  it("addComposedNode appends a <node> to the entry fork before </launch>", () => {
    const out = buildForkSet({
      ...baseInput(),
      composition: addComposedNode(emptyComposition(), {
        name: "my_probe",
        packageName: "topic_tools",
        executable: "echo",
        remaps: [{ from: "in", to: "/some/topic" }]
      })
    });
    const entryFork = out.forks.find((f) => f.path.endsWith("entry.launch.xml"))!;
    expect(entryFork.content).toMatch(/<node pkg="topic_tools" exec="echo" name="my_probe">/);
    expect(entryFork.content).toMatch(/<remap from="in" to="\/some\/topic"\/>/);
    // appears before </launch>
    expect(entryFork.content.indexOf("my_probe")).toBeLessThan(entryFork.content.indexOf("</launch>"));
  });

  it("disabling a node by its full runtime path removes the short-named block", () => {
    // graphStore stores composition.disabledNodeIds as node.id (full ROS path),
    // but the launch XML name attribute is the short basename.
    const nsEntry = "/ws/pkg/launch/ns_entry.launch.xml";
    const nsFiles = {
      ...files,
      [nsEntry]: `<launch>
  <group>
    <push-ros-namespace namespace="planning/trajectory_generator"/>
    <node pkg="pkg" exec="diffusion" name="diffusion_planner_node"/>
  </group>
  <node pkg="pkg" exec="keep" name="keep_me"/>
</launch>
`
    };
    const graph = parseStaticGraph(nsFiles, nsEntry, {});
    const diffusion = graph.nodes.find((node) => node.name === "diffusion_planner_node")!;
    expect(diffusion.id).toContain("/"); // full runtime path, not the short name

    const out = buildForkSet({
      ...baseInput(),
      entryLaunch: nsEntry,
      files: nsFiles,
      graph,
      composition: setNodeDisabled(emptyComposition(), diffusion.id, true)
    });
    const fork = out.forks.find((f) => f.path.endsWith("ns_entry.launch.xml"))!;
    expect(fork.content).not.toMatch(/name="diffusion_planner_node"/);
    expect(fork.content).toMatch(/name="keep_me"/);
  });

  it("Swap on an arg declared in a CHILD launch forks that child and rewrites the include", () => {
    // Reproduces the behavior_path_planner_type case: the switch arg lives deep
    // in the include chain, and only the switch is changed (no other edits).
    const swapEntry = "/ws/pkg/launch/swap_entry.launch.xml";
    const swapChild = "/ws/pkg/launch/swap_child.launch.xml";
    const swapFiles = {
      ...files,
      [swapEntry]: `<launch>
  <include file="$(find-pkg-share pkg)/launch/swap_child.launch.xml"/>
</launch>
`,
      [swapChild]: `<launch>
  <arg name="planner_type" default="planner_a" description="'planner_a' or 'planner_b'"/>
  <group if="$(eval &quot;'$(var planner_type)' == 'planner_a'&quot;)">
    <node pkg="pkg" exec="a" name="planner_a"/>
  </group>
  <group if="$(eval &quot;'$(var planner_type)' == 'planner_b'&quot;)">
    <node pkg="pkg" exec="b" name="planner_b"/>
  </group>
</launch>
`
    };
    const graph = parseStaticGraph(swapFiles, swapEntry, {});
    const out = buildForkSet({
      ...baseInput(),
      entryLaunch: swapEntry,
      files: swapFiles,
      graph,
      composition: setArgOverride(emptyComposition(), "planner_type", "planner_b")
    });

    const paths = out.forks.map((f) => f.path);
    expect(paths).toContain(`${FORKS_DIR}/pkg/launch/swap_child.launch.xml`);

    const childFork = out.forks.find((f) => f.path.endsWith("swap_child.launch.xml"))!;
    expect(childFork.content).toMatch(/<arg name="planner_type" default="planner_b"/);
    expect(childFork.content).not.toMatch(/default="planner_a"/);

    const entryFork = out.forks.find((f) => f.path.endsWith("swap_entry.launch.xml"))!;
    expect(entryFork.content).toContain(`<include file="${FORKS_DIR}/pkg/launch/swap_child.launch.xml"`);
  });

  it("remap on a $(var ...)-based topic rewrites the remap via its raw from anchor", () => {
    // Real launch files write <remap to="$(var X)">, while the override's
    // fromTopic is the resolved topic. The pin carries the raw `from`
    // ("~/output/trajectory") so the save step can target the exact remap.
    const varEntry = "/ws/pkg/launch/var_remap.launch.xml";
    const varFiles = {
      ...files,
      [varEntry]: `<launch>
  <arg name="output_trajectory" default="~/output/trajectory"/>
  <node pkg="pkg" exec="d" name="diffusion_planner_node">
    <remap from="~/output/trajectory" to="$(var output_trajectory)"/>
  </node>
</launch>
`
    };
    const graph = parseStaticGraph(varFiles, varEntry, {});
    const node = graph.nodes.find((n) => n.name === "diffusion_planner_node")!;
    const pin = node.outputs[0];
    expect(pin.remapFrom).toBe("~/output/trajectory");
    const out = buildForkSet({
      ...baseInput(),
      entryLaunch: varEntry,
      files: varFiles,
      graph,
      topicOverrides: [
        {
          nodeName: "diffusion_planner_node",
          pinKind: "output",
          fromTopic: pin.topicName,
          toTopic: "/remapped",
          fromRemap: pin.remapFrom
        }
      ]
    });
    const fork = out.forks.find((f) => f.path.endsWith("var_remap.launch.xml"))!;
    expect(fork.content).toContain('to="/remapped"');
    expect(fork.content).not.toContain('to="$(var output_trajectory)"');
  });

  it("legacy topic override (no fromRemap) still matches the literal to= attribute", () => {
    // Backward-compat: runtime-only pins may not carry a raw from.
    const out = buildForkSet({
      ...baseInput(),
      topicOverrides: [
        { nodeName: "psim_talker", pinKind: "output", fromTopic: "/psim/state", toTopic: "/legacy_topic" }
      ]
    });
    const childFork = out.forks.find((f) => f.path.endsWith("child.launch.xml"))!;
    expect(childFork.content).toMatch(/to="\/legacy_topic"/);
    expect(childFork.content).not.toMatch(/to="\/psim\/state"/);
  });

  it("Swap rewrites an Autoware module-preset (launch: yaml) default and its include", () => {
    // The preset is included before the launch tree and its DeclareLaunchArgument
    // wins over the deep <arg default>, so the swap must rewrite the preset too.
    const e = "/ws/pkg/launch/preset_entry.launch.xml";
    const presetPath = "/ws/pkg/config/preset/default_preset.yaml";
    const child = "/ws/pkg/launch/preset_child.launch.xml";
    const presetFiles = {
      ...files,
      [presetPath]: `launch:
  - arg:
      name: planner_type
      default: planner_a
    # option: planner_a / planner_b
`,
      [e]: `<launch>
  <include file="$(find-pkg-share pkg)/config/preset/default_preset.yaml"/>
  <include file="$(find-pkg-share pkg)/launch/preset_child.launch.xml"/>
</launch>
`,
      [child]: `<launch>
  <arg name="planner_type" default="planner_a"/>
  <group if="$(eval &quot;'$(var planner_type)' == 'planner_b'&quot;)">
    <node pkg="pkg" exec="b" name="planner_b"/>
  </group>
</launch>
`
    };
    const graph = parseStaticGraph(presetFiles, e, {});
    const out = buildForkSet({
      ...baseInput(),
      entryLaunch: e,
      files: presetFiles,
      graph,
      composition: setArgOverride(emptyComposition(), "planner_type", "planner_b")
    });

    const presetFork = out.forks.find((f) => f.path.endsWith("default_preset.yaml"))!;
    expect(presetFork.content).toContain("default: planner_b");
    expect(presetFork.content).not.toContain("default: planner_a");
    // comment and structure preserved
    expect(presetFork.content).toContain("# option: planner_a / planner_b");
    expect(presetFork.content).toContain("name: planner_type");

    // the include of the preset is rewritten to the fork
    const entryFork = out.forks.find((f) => f.path.endsWith("preset_entry.launch.xml"))!;
    expect(entryFork.content).toContain(`<include file="${FORKS_DIR}/pkg/config/preset/default_preset.yaml"`);
  });

  it("never writes under the original src tree", () => {
    const out = buildForkSet({
      ...baseInput(),
      composition: setNodeDisabled(setArgOverride(emptyComposition(), "vehicle_model", "alpha"), "listener", true),
      paramOverrides: [{ nodeName: "psim_talker", key: "gain", value: "9" }]
    });
    for (const fork of out.forks) {
      expect(fork.path.startsWith(`${FORKS_DIR}/`)).toBe(true);
      expect(fork.path.startsWith(`${SOURCE_ROOT}/`)).toBe(false);
    }
  });

  it("updates XML by element ranges, preserving quote style and multiline attributes", () => {
    const weirdEntry = "/ws/pkg/launch/weird.launch.xml";
    const weirdFiles = {
      ...files,
      [weirdEntry]: `<launch>
  <arg
    name='mode'
    default='old'/>
  <node
    pkg='pkg'
    exec='talker'
    name='talker'>
    <remap
      from='~/out'
      to='/old_topic'/>
    <param
      name='gain'
      value='1'/>
  </node>
</launch>
`
    };
    const graph = parseStaticGraph(weirdFiles, weirdEntry, {});
    const out = buildForkSet({
      ...baseInput(),
      entryLaunch: weirdEntry,
      files: weirdFiles,
      graph,
      composition: setArgOverride(emptyComposition(), "mode", "new"),
      paramOverrides: [{ nodeName: "talker", key: "gain", value: "2" }],
      topicOverrides: [{ nodeName: "talker", pinKind: "output", fromTopic: "/old_topic", toTopic: "/new_topic" }]
    });

    const fork = out.forks.find((item) => item.path.endsWith("weird.launch.xml"))!;
    expect(fork.content).toContain("default='new'");
    expect(fork.content).toContain("value='2'");
    expect(fork.content).toContain("to='/new_topic'");
    expect(fork.content).toContain("name='talker'");
  });
});

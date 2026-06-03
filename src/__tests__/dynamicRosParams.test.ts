import { describe, expect, it } from "vitest";
import {
  parseRosParamDescribe,
  parseRosParamEntriesByNode,
  parseRosParamGet,
  parseRosParamList,
  parseRosParamListByNode
} from "../../electron/ipc/files";

describe("ROS dynamic parameter CLI parsing", () => {
  it("parses ros2 param list output for a single node", () => {
    expect(parseRosParamList("  use_sim_time\n  threshold\n")).toEqual(["use_sim_time", "threshold"]);
    expect(parseRosParamList("  threshold (type: double)\n")).toEqual(["threshold"]);
  });

  it("parses grouped ros2 param list output", () => {
    const parsed = parseRosParamListByNode(`
/planning/foo:
  use_sim_time
  threshold
/control/bar:
  gain
`);
    expect(parsed.get("/planning/foo")).toEqual(["use_sim_time", "threshold"]);
    expect(parsed.get("/control/bar")).toEqual(["gain"]);
  });

  it("parses grouped ros2 param list output with types", () => {
    const parsed = parseRosParamEntriesByNode(`
/planning/foo:
  use_sim_time (type: boolean)
  threshold (type: double)
`);
    expect(parsed.get("/planning/foo")).toEqual([
      { name: "use_sim_time", parameterType: "boolean" },
      { name: "threshold", parameterType: "double" }
    ]);
  });

  it("parses read-only status and parameter type from ros2 param describe", () => {
    expect(
      parseRosParamDescribe(`
Parameter name: threshold
  Type: double
  Description: target threshold
  Constraints:
  Read only: False
`)
    ).toEqual({ parameterType: "double", readOnly: false, description: "target threshold" });
  });

  it("parses common ros2 param get scalar values", () => {
    expect(parseRosParamGet("Double value is: 2.5\n")).toBe(2.5);
    expect(parseRosParamGet("Boolean value is: True\n")).toBe(true);
    expect(parseRosParamGet("String value is: palta\n")).toBe("palta");
  });
});

// Initial seeds for the store. Everything machine-specific is derived from the
// entry launch the user picks in the GUI — there is no setup and no build-time
// configuration to provide:
//   - sourceRoot              → derived from the chosen launch on load
//   - output root             → resolved by Electron, or selected from the GUI
//   - map_path                → read from the launch's <arg name="map_path"> default
// So the seeds below are intentionally empty and fill in once a launch is chosen.
export const defaultConfig = {
  sourceRoot: "",
  entryLaunch: "",
  mapPath: "",
  // Standard rosbridge endpoint. Not derivable from a launch file; change here
  // (or add a GUI setting) if rosbridge runs on a non-default host/port.
  rosbridgeUrl: "ws://localhost:9090"
};

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;

// Default mock for the Electron preload bridge (window.api). Tests override per case.
(window as unknown as { api: Record<string, unknown> }).api = {
  readReachableFiles: vi.fn().mockResolvedValue({}),
  readText: vi.fn().mockResolvedValue(null),
  getOutputRoot: vi.fn().mockResolvedValue("/gui_tauri/autoware_graph_studio_overrides"),
  writeText: vi.fn().mockResolvedValue(undefined),
  writeTextFilesAtomically: vi.fn().mockResolvedValue(undefined),
  removePath: vi.fn().mockResolvedValue(undefined),
  chooseLaunchFile: vi.fn().mockResolvedValue(null),
  chooseOutputFolder: vi.fn().mockResolvedValue(null),
  pathForFile: vi.fn().mockReturnValue(""),
  rosParamSet: vi.fn().mockResolvedValue(undefined),
  rosDynamicParams: vi.fn().mockResolvedValue([]),
  restartNode: vi.fn().mockResolvedValue(undefined),
  ensureRosbridge: vi.fn().mockResolvedValue({ alreadyRunning: true })
};

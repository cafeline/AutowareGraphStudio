import { Global, css } from "@emotion/react";
import * as tokens from "../lib/designTokens";

const px = (value: number) => `${value}px`;

export function GlobalStyles() {
  return (
    <Global
      styles={css`
        :root {
          color-scheme: light;
          font-family: ${tokens.fontFamilySans};
          background: ${tokens.bgBase};
          color: ${tokens.textPrimary};
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
        }

        button,
        input,
        select {
          border: 1px solid ${tokens.borderDefault};
          border-radius: ${px(tokens.radiusMd)};
          background: ${tokens.bgElevated};
          color: ${tokens.textPrimary};
          padding: 8px 12px;
          font-size: ${px(tokens.fontSm)};
          font-family: inherit;
          transition:
            border-color 120ms ease,
            background 120ms ease,
            box-shadow 120ms ease;
        }

        button {
          cursor: pointer;
        }

        button:hover:not(:disabled) {
          border-color: ${tokens.borderStrong};
          background: ${tokens.bgHover};
        }

        button:active:not(:disabled) {
          background: ${tokens.bgActive};
        }

        button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        input:focus,
        select:focus,
        button:focus-visible {
          outline: none;
          border-color: ${tokens.accent};
          box-shadow: 0 0 0 3px ${tokens.accentSoft};
        }

        .react-flow__nodes {
          z-index: 2;
        }

        .react-flow__controls,
        .react-flow__minimap {
          z-index: 8;
        }

        .react-flow {
          background: ${tokens.bgSubtle};
        }

        .react-flow__background {
          background-color: ${tokens.bgSubtle};
        }

        .react-flow__controls {
          background: ${tokens.bgElevated};
          border: 1px solid ${tokens.borderSubtle};
          border-radius: ${px(tokens.radiusMd)};
          box-shadow: ${tokens.shadowMd};
          overflow: hidden;
        }

        .react-flow__controls-button {
          background: ${tokens.bgElevated};
          border-bottom: 1px solid ${tokens.borderSubtle};
          color: ${tokens.textSecondary};
        }

        .react-flow__controls-button:hover {
          background: ${tokens.bgHover};
          color: ${tokens.textPrimary};
        }

        .react-flow__controls-button svg {
          fill: currentColor;
        }

        .react-flow__handle {
          width: 1px;
          height: 1px;
          min-width: 0;
          min-height: 0;
          border: none;
          background: transparent;
          opacity: 0;
        }

        .react-flow__attribution {
          background: transparent;
          color: ${tokens.textFaint};
        }

        .react-flow__attribution a {
          color: ${tokens.textFaint};
        }

        .react-flow__edge.edge-inactive path,
        .edge-path.edge-inactive {
          stroke: ${tokens.borderDefault};
          stroke-width: 1.2;
        }

        .react-flow__edge.edge-active path,
        .edge-path.edge-active {
          stroke: ${tokens.accent};
          stroke-width: 2.5;
        }

        .react-flow__edge.edge-unknown path,
        .edge-path.edge-unknown {
          stroke: ${tokens.borderDefault};
          stroke-width: 1.4;
        }

        .react-flow__edge-text,
        .edge-label {
          fill: ${tokens.textSecondary};
          color: ${tokens.textSecondary};
          font-size: ${px(tokens.fontXs)};
          font-family: ${tokens.fontFamilyMono};
          pointer-events: none;
          position: absolute;
          text-shadow: 0 1px 2px rgba(255, 255, 255, 0.92);
          white-space: nowrap;
        }
      `}
    />
  );
}

import "@testing-library/jest-dom/vitest";
import { registerFixtureWidget } from "./tests/helpers/fixture-widget";

// Register the generic test-only widget type before any test file runs.
registerFixtureWidget();

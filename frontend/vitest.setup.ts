import "@testing-library/jest-dom/vitest";

// The fixture-widget render registration is deliberately NOT global here: it
// would leak "test.fixture" into tests/modules/registry-parity.test.ts, which
// asserts the render registry's type set matches widget-types.gen.json
// exactly. Tests that need the fixture widget call
// registerFixtureRenderWidget() themselves (see tests/helpers/fixture-widget.ts).

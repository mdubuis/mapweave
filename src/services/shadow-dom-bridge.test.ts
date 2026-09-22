// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetShadowDomBridgeForTests,
  getPrimaryMountRoot,
  installShadowDomBridge,
  registerShadowRoot,
  unregisterShadowRoot
} from "./shadow-dom-bridge";

function attachShadowHost(): { host: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  return { host, shadow };
}

afterEach(() => {
  _resetShadowDomBridgeForTests();
  document.body.innerHTML = "";
});

describe("installShadowDomBridge — getElementById", () => {
  it("returns the light-DOM element when one exists, unchanged behavior", () => {
    installShadowDomBridge();
    const lightEl = document.createElement("div");
    lightEl.id = "light-only";
    document.body.appendChild(lightEl);

    expect(document.getElementById("light-only")).toBe(lightEl);
  });

  it("falls back to a registered shadow root when the light DOM misses", () => {
    installShadowDomBridge();
    const { shadow } = attachShadowHost();
    registerShadowRoot(shadow);
    const shadowEl = document.createElement("div");
    shadowEl.id = "shadow-only";
    shadow.appendChild(shadowEl);

    expect(document.getElementById("shadow-only")).toBe(shadowEl);
  });

  it("prefers the light-DOM element over a same-id shadow element", () => {
    installShadowDomBridge();
    const { shadow } = attachShadowHost();
    registerShadowRoot(shadow);
    const shadowEl = document.createElement("div");
    shadowEl.id = "dup";
    shadow.appendChild(shadowEl);

    const lightEl = document.createElement("div");
    lightEl.id = "dup";
    document.body.appendChild(lightEl);

    expect(document.getElementById("dup")).toBe(lightEl);
  });

  it("returns null when the id exists in neither the light DOM nor any registered shadow root", () => {
    installShadowDomBridge();
    attachShadowHost();
    expect(document.getElementById("nowhere")).toBeNull();
  });

  it("does not fall back into an unregistered shadow root", () => {
    installShadowDomBridge();
    const { shadow } = attachShadowHost(); // note: never registered
    const shadowEl = document.createElement("div");
    shadowEl.id = "not-registered";
    shadow.appendChild(shadowEl);

    expect(document.getElementById("not-registered")).toBeNull();
  });

  it("stops falling back once the shadow root is unregistered", () => {
    installShadowDomBridge();
    const { shadow } = attachShadowHost();
    const shadowEl = document.createElement("div");
    shadowEl.id = "temp";
    shadow.appendChild(shadowEl);
    registerShadowRoot(shadow);

    expect(document.getElementById("temp")).toBe(shadowEl);
    unregisterShadowRoot(shadow);
    expect(document.getElementById("temp")).toBeNull();
  });

  it("checks multiple registered shadow roots", () => {
    installShadowDomBridge();
    const first = attachShadowHost();
    const second = attachShadowHost();
    registerShadowRoot(first.shadow);
    registerShadowRoot(second.shadow);

    const el = document.createElement("div");
    el.id = "in-second";
    second.shadow.appendChild(el);

    expect(document.getElementById("in-second")).toBe(el);
  });
});

describe("installShadowDomBridge — querySelector", () => {
  beforeEach(() => installShadowDomBridge());

  it("returns the light-DOM match unchanged when one exists", () => {
    const lightEl = document.createElement("div");
    lightEl.id = "q-light";
    document.body.appendChild(lightEl);

    expect(document.querySelector("#q-light")).toBe(lightEl);
  });

  it("falls back to a registered shadow root for a bare #id selector", () => {
    const { shadow } = attachShadowHost();
    const shadowEl = document.createElement("div");
    shadowEl.id = "q-shadow";
    shadow.appendChild(shadowEl);
    registerShadowRoot(shadow);

    expect(document.querySelector("#q-shadow")).toBe(shadowEl);
  });

  it("does not fall back for a non-bare-id selector, even if it would match inside the shadow root", () => {
    const { shadow } = attachShadowHost();
    const shadowEl = document.createElement("div");
    shadowEl.className = "q-class";
    shadow.appendChild(shadowEl);
    registerShadowRoot(shadow);

    expect(document.querySelector(".q-class")).toBeNull();
    expect(document.querySelector("div.q-class")).toBeNull();
  });
});

describe("installShadowDomBridge — idempotence", () => {
  it("installing twice does not double-wrap or break lookups", () => {
    installShadowDomBridge();
    installShadowDomBridge();

    const { shadow } = attachShadowHost();
    const shadowEl = document.createElement("div");
    shadowEl.id = "double-install";
    shadow.appendChild(shadowEl);
    registerShadowRoot(shadow);

    expect(document.getElementById("double-install")).toBe(shadowEl);
  });
});

describe("getPrimaryMountRoot", () => {
  it("returns document.body when no shadow root is registered", () => {
    expect(getPrimaryMountRoot()).toBe(document.body);
  });

  it("returns the registered shadow root once one exists", () => {
    const { shadow } = attachShadowHost();
    registerShadowRoot(shadow);
    expect(getPrimaryMountRoot()).toBe(shadow);
  });

  it("returns the most recently registered shadow root when more than one is registered", () => {
    const first = attachShadowHost();
    const second = attachShadowHost();
    registerShadowRoot(first.shadow);
    registerShadowRoot(second.shadow);
    expect(getPrimaryMountRoot()).toBe(second.shadow);
  });

  it("falls back to document.body again once the shadow root is unregistered", () => {
    const { shadow } = attachShadowHost();
    registerShadowRoot(shadow);
    unregisterShadowRoot(shadow);
    expect(getPrimaryMountRoot()).toBe(document.body);
  });
});

describe("_resetShadowDomBridgeForTests", () => {
  it("restores real getElementById/querySelector behavior after reset", () => {
    installShadowDomBridge();
    const { shadow } = attachShadowHost();
    const shadowEl = document.createElement("div");
    shadowEl.id = "reset-check";
    shadow.appendChild(shadowEl);
    registerShadowRoot(shadow);

    expect(document.getElementById("reset-check")).toBe(shadowEl);

    _resetShadowDomBridgeForTests();
    expect(document.getElementById("reset-check")).toBeNull();
    expect(document.querySelector("#reset-check")).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { safeReturnTo } from "./auth";

describe("OAuth return paths", () => {
  test.each(["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example", "javascript:alert(1)", "", null, undefined])("rejects external or browser-normalized destination %j", (input) => {
    expect(safeReturnTo(input, "/profile")).toBe("/profile");
  });
  test.each(["/profile", "/internal/orders?page=2", "/docs/intro#hello", "/projects/12?return_to=%2Fprofile"])("preserves local destination %s", (input) => {
    expect(safeReturnTo(input, "/profile")).toBe(input);
  });
});

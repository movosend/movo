import { describe, expect, it } from "vitest"
import { internalReturnPath } from "./policy"

const ID = "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6"

describe("internalReturnPath", () => {
  it.each([
    "/",
    "/admins",
    "/users",
    "/users?q=marcos&page=2",
    `/users/${ID}`,
    "/disputes",
    "/disputes?status=resolved&city=Cordoba",
    `/disputes/${ID}`,
    `/disputes/${ID}?from=status%3Dresolved`,
  ])(
    "acepta %s",
    (path) => expect(internalReturnPath(path)).toBe(path)
  )

  it.each([
    null,
    "/login",
    "//evil.test",
    "https://evil.test/users",
    "/users/abc",
    `/users/${ID}/../../login`,
    "/users?next=//evil.test",
    "/users#x",
    "/disputes/abc",
    `/disputes/${ID}/../../login`,
    "/disputes?next=//evil.test",
  ])("descarta %s", (path) => expect(internalReturnPath(path)).toBe("/"))
})

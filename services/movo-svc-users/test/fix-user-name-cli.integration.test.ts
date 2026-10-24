import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole } from "@movo/shared";
import { createPrismaClient } from "../src/plugins/db";
import { createUserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";
import { runFixUserNameCli } from "../src/scripts/fix-user-name";

describe("CLI de corrección de nombres (MOVO-340)", () => {
  const db = createPrismaClient(process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo");
  const repo = createUserRepository(db);
  let out: string[];
  let err: string[];
  const output = { out: (m: string) => out.push(m), err: (m: string) => err.push(m) };

  const buildInput = (overrides: Partial<CreateUserInput>): CreateUserInput => ({
    email: `user-${randomUUID()}@movo.test`,
    phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
    firstName: "Alena",
    lastName: "Ariza",
    passwordHash: "hashed_password",
    roles: [UserRole.SENDER],
    phoneVerified: true,
    address: { street: "Av. Colón", number: "1234", city: "Córdoba", province: "Córdoba", zip: "5000", lat: -31.42, long: -64.18 },
    ...overrides,
  });

  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    out = [];
    err = [];
    await db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  it("list muestra solo las cuentas con apellido de más de una palabra", async () => {
    const broken = await repo.create(buildInput({ firstName: "Juan", lastName: "Cruz Bordino Blanche" }));
    await repo.create(buildInput({ firstName: "Pedro", lastName: "Yorlano" }));

    expect(await runFixUserNameCli(["list"], db, output)).toBe(0);
    expect(out).toEqual([`${broken.email}\tnombre: Juan\tapellido: Cruz Bordino Blanche`]);
  });

  it("set corrige nombre y apellido por email", async () => {
    const broken = await repo.create(buildInput({ firstName: "Juan", lastName: "Cruz Bordino Blanche" }));

    const code = await runFixUserNameCli(["set", broken.email.toUpperCase(), " Juan  Cruz ", "Bordino Blanche"], db, output);

    expect(code).toBe(0);
    expect(await db.user.findUnique({ where: { id: broken.id } })).toMatchObject({
      firstName: "Juan Cruz",
      lastName: "Bordino Blanche",
    });
    expect(out[0]).toContain('pasó a "Juan Cruz" + "Bordino Blanche"');
  });

  it("set con un email inexistente o un nombre vacío no cambia nada", async () => {
    expect(await runFixUserNameCli(["set", "nadie@movo.test", "Juan", "Pérez"], db, output)).toBe(1);
    expect(await runFixUserNameCli(["set", "nadie@movo.test", "  ", "Pérez"], db, output)).toBe(2);
    expect(await runFixUserNameCli(["set", "nadie@movo.test"], db, output)).toBe(2);
    expect(err).toHaveLength(3);
  });
});

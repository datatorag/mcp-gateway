/**
 * A fixed provider-token key for every test run (SCRUM-442).
 *
 * CONNECTION_TOKEN_KEYS is required with no default, so any suite that loads
 * the real config would otherwise refuse to start. The key is made from a
 * constant byte, not written out: it seals nothing real, and a literal key in
 * the repository would read as a leaked one. A value already set (a run
 * against a development database) is left alone.
 */
process.env.CONNECTION_TOKEN_KEYS ??= `test:${Buffer.alloc(32, 0x5a).toString("base64")}`;

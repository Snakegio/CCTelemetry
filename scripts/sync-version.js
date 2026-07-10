// Runs as npm's "version" lifecycle script (see package.json), right after
// `npm version <x>` bumps package.json but before it commits + tags.
// Keeps src-tauri/Cargo.toml (+ lockfile) and PKGBUILD in sync so
// `npm version` is the single command that bumps every version string in
// the repo. tauri.conf.json needs no sync: its "version" points at package.json.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const { version } = require("../package.json");
const cargoTomlPath = path.join(__dirname, "../src-tauri/Cargo.toml");
const pkgbuildPath = path.join(__dirname, "../PKGBUILD");

const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
fs.writeFileSync(cargoTomlPath, cargoToml.replace(/^version = ".*"$/m, `version = "${version}"`));

const pkgbuild = fs.readFileSync(pkgbuildPath, "utf8");
fs.writeFileSync(pkgbuildPath, pkgbuild.replace(/^pkgver=.*$/m, `pkgver=${version}`));

execSync("cargo check --quiet", { cwd: path.join(__dirname, "../src-tauri"), stdio: "inherit" });

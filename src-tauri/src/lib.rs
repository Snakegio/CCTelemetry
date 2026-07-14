use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

mod commands;

const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const NO_CREDS_ERROR: &str = "No credentials found";

// Reads the Claude Code OAuth token: macOS Keychain, then the Linux/cross-platform
// credentials file locations, then the env var — same order/sources upstream
// cclimits (https://github.com/cruzanstx/cclimits) uses, previously vendored
// here as a Python script and run as a subprocess.
fn claude_credentials(app: &tauri::AppHandle) -> Option<String> {
    fn token_from(creds: &serde_json::Value) -> Option<String> {
        creds["claudeAiOauth"]["accessToken"]
            .as_str()
            .or_else(|| creds["accessToken"].as_str())
            .map(str::to_string)
    }

    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
    {
        if out.status.success() {
            if let Ok(creds) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                if let Some(token) = token_from(&creds) {
                    return Some(token);
                }
            }
        }
    }

    if let Ok(home) = app.path().home_dir() {
        for path in [
            home.join(".claude").join(".credentials.json"),
            home.join(".claude").join("credentials.json"),
            home.join(".config").join("claude").join("credentials.json"),
        ] {
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Ok(creds) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(token) = token_from(&creds) {
                        return Some(token);
                    }
                }
            }
        }
    }

    std::env::var("CLAUDE_ACCESS_TOKEN").ok()
}

// Howard Hinnant's days-from-civil algorithm (public domain,
// http://howardhinnant.github.io/date_algorithms.html): days since
// 1970-01-01 for a proleptic-Gregorian y/m/d. Avoids a date/time crate for
// the one timestamp conversion below.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = m as i64 + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

// Parses "YYYY-MM-DDTHH:MM:SS[.fff](Z|+HH:MM)" (what the Anthropic usage API
// returns) to Unix seconds. Timezone offset is ignored — the API always
// reports UTC ("Z").
fn parse_iso8601_utc(s: &str) -> Option<i64> {
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: u32 = s.get(5..7)?.parse().ok()?;
    let day: u32 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let minute: i64 = s.get(14..16)?.parse().ok()?;
    let second: i64 = s.get(17..19)?.parse().ok()?;
    Some(days_from_civil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second)
}

// Formats an ISO timestamp as a relative "1h 30m" / "45m" / "Now" countdown.
// Formats a countdown to `delta` seconds from now: "Now" once past, else "1h 30m" / "45m".
fn format_delta(delta: i64) -> String {
    if delta < 0 {
        return "Now".to_string();
    }
    let (hours, minutes) = (delta / 3600, (delta % 3600) / 60);
    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
}

fn format_reset_time(iso: Option<&str>) -> String {
    let Some(iso) = iso else { return "N/A".to_string() };
    let Some(reset_at) = parse_iso8601_utc(iso) else { return iso.chars().take(19).collect() };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    format_delta(reset_at - now)
}

// Fetches the 5-hour/weekly usage windows from Anthropic's OAuth usage
// endpoint, shaped like cclimits' own `--claude --json` output (trimmed to
// the fields update_tray actually reads).
fn claude_usage(app: &tauri::AppHandle) -> serde_json::Value {
    let Some(token) = claude_credentials(app) else {
        return serde_json::json!({ "error": NO_CREDS_ERROR, "hint": "Run 'claude' and authenticate first" });
    };

    let response = ureq::get("https://api.anthropic.com/api/oauth/usage")
        .timeout(HTTP_TIMEOUT)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", "oauth-2025-04-20")
        .set("Content-Type", "application/json")
        .call();
    let (status, body) = match response {
        Ok(resp) => (resp.status(), resp.into_string().unwrap_or_default()),
        Err(ureq::Error::Status(code, resp)) => (code, resp.into_string().unwrap_or_default()),
        Err(e) => return serde_json::json!({ "error": "Connection error", "details": e.to_string() }),
    };
    if status == 401 {
        return serde_json::json!({ "error": "Token expired", "hint": "Run 'claude' to re-authenticate" });
    }
    let data: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) if status == 200 => v,
        _ => {
            let details: String = body.chars().take(200).collect();
            return serde_json::json!({ "error": format!("HTTP {status}"), "details": details });
        }
    };

    let window = |key: &str| -> Option<serde_json::Value> {
        let w = data.get(key)?;
        if w.is_null() {
            return None;
        }
        let util = w["utilization"].as_f64().unwrap_or(0.0);
        Some(serde_json::json!({
            "used": format!("{:.1}%", util),
            "remaining": format!("{:.1}%", 100.0 - util),
            "resets_in": format_reset_time(w["resets_at"].as_str()),
        }))
    };

    let mut result = serde_json::Map::new();
    result.insert("status".to_string(), serde_json::json!("ok"));
    if let Some(v) = window("five_hour") {
        result.insert("five_hour".to_string(), v);
    }
    if let Some(v) = window("seven_day") {
        result.insert("seven_day".to_string(), v);
    }
    if let Some(opus) = data.get("seven_day_opus").filter(|v| !v.is_null()) {
        let util = opus["utilization"].as_f64().unwrap_or(0.0);
        result.insert("opus".to_string(), serde_json::json!({ "used": format!("{:.1}%", util) }));
    }
    serde_json::Value::Object(result)
}

fn cclimits_cache_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().home_dir().ok()?.join(".cache").join("cclimits").join("usage.json"))
}

// Cache is shared on disk (~/.cache/cclimits/usage.json) with any real
// cclimits CLI the user has installed for their shell prompt/cron, so this
// app's 60s poll coalesces with those instead of separately hammering the
// Anthropic usage endpoint (which returns HTTP 429 when polled fresh each
// time). Returns the cached "claude" entry if younger than `ttl_secs`.
fn read_cclimits_cache(app: &tauri::AppHandle, ttl_secs: u64) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(cclimits_cache_path(app)?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    if now.saturating_sub(v["timestamp"].as_u64()?) >= ttl_secs {
        return None;
    }
    v["data"]["claude"].as_object().map(|o| serde_json::Value::Object(o.clone()))
}

// Missing credentials in this run shouldn't erase a good result cached by an
// environment that has them (e.g. a cron job running as a different user).
fn write_cclimits_cache(app: &tauri::AppHandle, claude_data: &serde_json::Value) {
    let Some(path) = cclimits_cache_path(app) else { return };
    let mut data = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["data"].as_object().cloned())
        .unwrap_or_default();

    let keep_old = claude_data["error"] == NO_CREDS_ERROR
        && data.get("claude").is_some_and(|old| old["error"] != NO_CREDS_ERROR);
    if !keep_old {
        data.insert("claude".to_string(), claude_data.clone());
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let out = serde_json::json!({ "timestamp": now, "data": serde_json::Value::Object(data) });
    let Some(parent) = path.parent() else { return };
    let _ = std::fs::create_dir_all(parent);
    let tmp = path.with_extension("json.tmp");
    // Atomic write: concurrent runs (this app vs. a shell statusline/cron) must
    // never see a half-written cache file.
    if std::fs::write(&tmp, out.to_string()).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

// Returns the cclimits-shaped {"claude": {...}} usage payload, using the
// on-disk cache when fresh (see read_cclimits_cache) and fetching otherwise.
fn run_cclimits(app: &tauri::AppHandle) -> serde_json::Value {
    const CACHE_TTL_SECS: u64 = 60;
    let claude = match read_cclimits_cache(app, CACHE_TTL_SECS) {
        Some(cached) => cached,
        None => {
            let fresh = claude_usage(app);
            write_cclimits_cache(app, &fresh);
            fresh
        }
    };
    serde_json::json!({ "claude": claude })
}

// Rounds a "4.0%" string to "4%". Falls back to the raw string on parse failure.
fn pct_round(used: &str) -> String {
    match used.trim_end_matches('%').trim().parse::<f64>() {
        Ok(n) => format!("{}%", n.round() as i64),
        Err(_) => used.to_string(),
    }
}

// 3x5 pixel bitmaps for the digits + "!". Windows tray icons have no
// text-label API — Shell_NotifyIcon only ever accepts a bitmap — and Linux's
// AppIndicator set_label (via tray.set_title) doesn't actually render next to
// the icon on most desktop environments (GNOME included), so both platforms
// bake the number directly into the icon's pixels instead of pulling in a
// font-rendering dependency for eleven glyphs. macOS is the only platform
// where the title reliably shows up next to the icon.
#[cfg(any(windows, target_os = "linux"))]
fn glyph_bits(ch: char) -> Option<[u8; 5]> {
    Some(match ch {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b001, 0b001, 0b001],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '!' => [0b010, 0b010, 0b010, 0b000, 0b010],
        _ => return None,
    })
}

#[cfg(any(windows, target_os = "linux"))]
const BADGE_SIZE: u32 = 22;
#[cfg(any(windows, target_os = "linux"))]
const GLYPH_SCALE: u32 = 3;
#[cfg(any(windows, target_os = "linux"))]
const GLYPH_W: u32 = 3 * GLYPH_SCALE;
#[cfg(any(windows, target_os = "linux"))]
const GLYPH_H: u32 = 5 * GLYPH_SCALE;
#[cfg(any(windows, target_os = "linux"))]
const GLYPH_GAP: u32 = GLYPH_SCALE;

// Renders `text` (digits and "!" only; anything else is skipped) as opaque
// white pixels on a transparent background, sized for a tray icon.
#[cfg(any(windows, target_os = "linux"))]
fn render_badge_icon(text: &str) -> tauri::image::Image<'static> {
    let glyphs: Vec<[u8; 5]> = text.chars().filter_map(glyph_bits).collect();
    let n = glyphs.len().max(1) as u32;
    let total_w = n * GLYPH_W + (n - 1) * GLYPH_GAP;
    let x_off = BADGE_SIZE.saturating_sub(total_w) / 2;
    let y_off = BADGE_SIZE.saturating_sub(GLYPH_H) / 2;

    let mut rgba = vec![0u8; (BADGE_SIZE * BADGE_SIZE * 4) as usize];
    for (i, glyph) in glyphs.iter().enumerate() {
        let dx = x_off + i as u32 * (GLYPH_W + GLYPH_GAP);
        for (row, bits) in glyph.iter().enumerate() {
            for col in 0..3u32 {
                if (bits >> (2 - col)) & 1 != 1 {
                    continue;
                }
                for sy in 0..GLYPH_SCALE {
                    for sx in 0..GLYPH_SCALE {
                        let px = dx + col * GLYPH_SCALE + sx;
                        let py = y_off + row as u32 * GLYPH_SCALE + sy;
                        if px < BADGE_SIZE && py < BADGE_SIZE {
                            let idx = ((py * BADGE_SIZE + px) * 4) as usize;
                            rgba[idx..idx + 4].copy_from_slice(&[255, 255, 255, 255]);
                        }
                    }
                }
            }
        }
    }
    tauri::image::Image::new_owned(rgba, BADGE_SIZE, BADGE_SIZE)
}

// Windows/Linux: swaps the tray icon itself for a rendered badge, since
// set_title's text doesn't reliably show up next to the icon on either (see
// glyph_bits above). No-op on macOS, which already gets the number via
// set_title (title-next-to-icon).
#[cfg(any(windows, target_os = "linux"))]
fn set_tray_badge(app: &tauri::AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(render_badge_icon(text)));
    }
}
#[cfg(not(any(windows, target_os = "linux")))]
fn set_tray_badge(_app: &tauri::AppHandle, _text: &str) {}

fn claude_installed(app: &tauri::AppHandle) -> bool {
    app.path()
        .home_dir()
        .map(|h| h.join(".claude").is_dir())
        .unwrap_or(false)
}

// Persisted from the Settings page (see commands::write_notify_settings).
// `Default` gives a safe all-off fallback when settings.json doesn't exist
// yet or fails to parse.
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NotifySettings {
    enabled: bool,
    five_hour_threshold: f64,
    weekly_threshold: f64,
}

// Re-arm state for the two threshold notifications: true once a crossing
// has been notified, reset back to false when the percentage drops back
// under the threshold (which happens naturally when the window resets).
static FIVE_HOUR_NOTIFIED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static WEEKLY_NOTIFIED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

// Pure decision for whether a fresh notification is due, given the current
// percentage, its threshold, and whether one was already sent for the
// current crossing. Returns (should_notify_now, next_armed_state).
fn crosses_threshold(pct: f64, threshold: f64, already_notified: bool) -> (bool, bool) {
    if pct < threshold {
        (false, false)
    } else if already_notified {
        (false, true)
    } else {
        (true, true)
    }
}

// Fires a native OS notification the first time `pct` reaches `threshold`,
// then stays quiet until `pct` drops back under it. No-ops if the OS
// notification permission hasn't been granted (requested from the
// frontend when the user turns the Settings toggle on).
fn maybe_notify(app: &tauri::AppHandle, pct: f64, threshold: f64, already: &std::sync::atomic::AtomicBool, body: &str) {
    use std::sync::atomic::Ordering;
    let (should_notify, armed) = crosses_threshold(pct, threshold, already.load(Ordering::Relaxed));
    already.store(armed, Ordering::Relaxed);
    if !should_notify {
        return;
    }
    let granted = app
        .notification()
        .permission_state()
        .map(|s| s == tauri_plugin_notification::PermissionState::Granted)
        .unwrap_or(false);
    if granted {
        let _ = app.notification().builder().title("CCTelemetry").body(body).show();
    }
}

// Reads the user's configured thresholds and notifies on each crossing.
// `h5_pct`/`wk_pct` are `None` when that window's percentage wasn't
// available this tick (e.g. a transient API error) — skipped, not treated
// as 0%.
fn check_usage_thresholds(app: &tauri::AppHandle, h5_pct: Option<f64>, wk_pct: Option<f64>) {
    let settings: NotifySettings =
        serde_json::from_str(&commands::read_notify_settings(app.clone())).unwrap_or_default();
    if !settings.enabled {
        return;
    }
    if let Some(n) = h5_pct {
        let body = format!("Claude Code usage has reached {}% of your 5-hour session limit.", n.round() as i64);
        maybe_notify(app, n, settings.five_hour_threshold, &FIVE_HOUR_NOTIFIED, &body);
    }
    if let Some(n) = wk_pct {
        let body = format!("Claude Code usage has reached {}% of your weekly limit.", n.round() as i64);
        maybe_notify(app, n, settings.weekly_threshold, &WEEKLY_NOTIFIED, &body);
    }
}

// Polls cclimits and pushes the 5-hour used % to the tray title (macOS shows it
// next to the icon) and to a rendered icon badge (Windows/Linux, see
// set_tray_badge). Runs on a native
// thread so it keeps ticking while the dashboard window is hidden — WKWebview
// throttles/suspends JS timers in hidden windows, which is why this can't live
// in the webview. On any failure we leave the previous title in place rather
// than blanking it — except when Claude Code itself isn't installed, which
// gets an explicit "!" so the user isn't left staring at stale numbers.
fn update_tray(app: &tauri::AppHandle) {
    if !claude_installed(app) {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_title(Some("!"));
            let _ = tray.set_tooltip(Some("Claude Code non trovato (~/.claude mancante)"));
        }
        set_tray_badge(app, "!");
        return;
    }
    let v = run_cclimits(app);
    let c = &v["claude"];
    if c["status"] != "ok" {
        return;
    }
    let (h5, wk) = (&c["five_hour"], &c["seven_day"]);
    let get = |o: &serde_json::Value, k: &str| o[k].as_str().unwrap_or("").to_string();
    let (h5_used, wk_used) = (get(h5, "used"), get(wk, "used"));
    if h5_used.is_empty() {
        return;
    }
    let title = pct_round(&h5_used);
    let tooltip = format!(
        "5h {} · resets {}  |  Weekly {} · resets {}",
        h5_used,
        get(h5, "resets_in"),
        wk_used,
        get(wk, "resets_in"),
    );
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(Some(title.as_str()));
        let _ = tray.set_tooltip(Some(tooltip.as_str()));
    }
    let h5_pct = h5_used.trim_end_matches('%').trim().parse::<f64>().ok();
    if let Some(n) = h5_pct {
        // Clipped, not wrong, if usage ever prints 3 digits (100%) — the
        // badge just renders every digit it's given (see render_badge_icon).
        set_tray_badge(app, &(n.round() as i64).max(0).to_string());
    }
    let wk_pct = wk_used.trim_end_matches('%').trim().parse::<f64>().ok();
    check_usage_thresholds(app, h5_pct, wk_pct);
}

// Extracts every "$X/MTok" price in a line, in order (there's no pricing
// API, only Anthropic's human-facing markdown pricing doc, so this is
// inherently a screen-scrape of a fixed table layout).
fn extract_mtok_prices(line: &str) -> Vec<f64> {
    line.split('$')
        .skip(1)
        .filter_map(|segment| {
            let end = segment.find(|c: char| !c.is_ascii_digit() && c != '.').unwrap_or(segment.len());
            let (number, rest) = segment.split_at(end);
            let rest = rest.trim_start().strip_prefix('/')?.trim_start();
            rest.starts_with("MTok").then(|| number.parse().ok())?
        })
        .collect()
}

// Markdown table cells wrap the model name in a `[Name](url)` link; unwrap it.
fn strip_markdown_link(cell: &str) -> String {
    let cell = cell.trim();
    let Some(open) = cell.find('[') else { return cell.to_string() };
    let Some(close) = cell[open..].find(']').map(|i| open + i) else { return cell.to_string() };
    let Some(paren_close) = cell[close..].find(')').filter(|_| cell[close..].starts_with("](")) else {
        return cell.to_string();
    };
    format!("{}{}{}", &cell[..open], &cell[open + 1..close], &cell[close + paren_close + 1..])
}

// Parses Anthropic's public $/MTok pricing table into tier -> {in, out}.
// Skips deprecated/retired models and temporary promo-pricing rows ("through
// Aug 2026" / "starting Sep 2026") — we want each tier's one standing price,
// not a soon-to-expire introductory rate.
fn parse_pricing_table(text: &str) -> serde_json::Map<String, serde_json::Value> {
    const TIERS: [(&str, &[&str]); 4] = [
        ("fable", &["fable", "mythos"]),
        ("opus", &["opus"]),
        ("sonnet", &["sonnet"]),
        ("haiku", &["haiku"]),
    ];
    const EXCLUDE: [&str; 4] = ["deprecated", "retired", "through", "starting"];

    let mut result = serde_json::Map::new();
    for line in text.lines() {
        if !line.starts_with('|') {
            continue;
        }
        let prices = extract_mtok_prices(line);
        if prices.len() != 5 {
            continue; // only the base model-pricing table has 5 price columns
        }
        let Some(name_cell) = line.split('|').nth(1) else { continue };
        let name = strip_markdown_link(name_cell).to_lowercase();
        if EXCLUDE.iter().any(|kw| name.contains(kw)) {
            continue;
        }
        for (tier, keywords) in TIERS {
            if !result.contains_key(tier) && keywords.iter().any(|kw| name.contains(kw)) {
                result.insert(tier.to_string(), serde_json::json!({ "in": prices[0], "out": prices[4] }));
            }
        }
    }
    result
}

// Fetches Anthropic's public pricing page and returns tier -> {in, out}
// $/MTok, possibly empty on any failure (network hiccup, page redesign) —
// the caller keeps its last known-good prices in that case.
fn fetch_pricing() -> serde_json::Value {
    let body = ureq::get("https://platform.claude.com/docs/en/about-claude/pricing.md")
        .timeout(HTTP_TIMEOUT)
        .set("User-Agent", "Mozilla/5.0")
        .call()
        .ok()
        .and_then(|resp| resp.into_string().ok())
        .unwrap_or_default();
    serde_json::Value::Object(parse_pricing_table(&body))
}

// Refreshes the cached $/MTok pricing table from Anthropic's public pricing
// page once a day. There's no pricing API for this — it's a screen-scrape of
// a human-facing doc — so a parse failure (page redesign, network hiccup)
// just leaves the existing cache file alone; the frontend falls back to its
// own hardcoded defaults if the cache has never been written.
fn maybe_refresh_pricing(app: &tauri::AppHandle) {
    let Ok(app_data) = app.path().app_data_dir() else { return };
    let path = app_data.join("data").join("pricing.json");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&existing) {
            if let Some(fetched_at) = v["fetchedAt"].as_u64() {
                if now.saturating_sub(fetched_at) < 24 * 3600 {
                    return; // cache is fresh enough
                }
            }
        }
    }
    let prices = fetch_pricing();
    if !prices.as_object().is_some_and(|o| !o.is_empty()) {
        return; // nothing parsed — keep whatever cache we already have
    }
    let out = serde_json::json!({ "fetchedAt": now, "prices": prices });
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, out.to_string());
}

// Checks GitHub releases for a newer signed build and, if found, downloads
// and installs it silently then restarts — no dialog, since this is a
// tray utility with no unsaved state to lose. Runs once at launch and then
// once a day alongside the pricing refresh cadence.
async fn check_for_update(app: tauri::AppHandle) {
    let Ok(updater) = app.updater() else { return };
    let Ok(Some(update)) = updater.check().await else { return };
    if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
        app.restart();
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_sessions,
            commands::read_sessions,
            commands::claude_exists,
            commands::get_pricing,
            commands::read_history,
            commands::write_history,
            commands::read_notify_settings,
            commands::write_notify_settings,
            commands::send_test_notification,
        ])
        .setup(|app| {
            // menu-bar app: no Dock icon on macOS
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let open = MenuItemBuilder::with_id("open", "Dashboard").build(app)?;
            let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let about = MenuItemBuilder::with_id("about", "About").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open, &settings, &about, &quit]).build()?;

            let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("CCTelemetry")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        show_main(app);
                        let _ = app.emit("navigate", "dashboard");
                    }
                    "settings" => {
                        show_main(app);
                        let _ = app.emit("navigate", "settings");
                    }
                    "about" => {
                        show_main(app);
                        let _ = app.emit("navigate", "about");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // Native poll loop: keeps the tray % fresh even while the window is
            // hidden. 60s cadence matches cclimits' cache TTL.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                update_tray(&handle);
                std::thread::sleep(std::time::Duration::from_secs(60));
            });

            // Checks hourly, only actually fetches once the daily cache goes stale.
            let handle2 = app.handle().clone();
            std::thread::spawn(move || loop {
                maybe_refresh_pricing(&handle2);
                std::thread::sleep(std::time::Duration::from_secs(3600));
            });

            // Checks for a new release once at launch and once a day after that.
            let handle3 = app.handle().clone();
            std::thread::spawn(move || loop {
                tauri::async_runtime::block_on(check_for_update(handle3.clone()));
                std::thread::sleep(std::time::Duration::from_secs(24 * 3600));
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the window keeps the app (and tray updates) alive
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Guards the hand-rolled parsing this file took over from the old Python
// scripts (ISO-8601 date math, markdown-table scraping) — run with `cargo test`.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso8601_matches_known_unix_timestamps() {
        assert_eq!(parse_iso8601_utc("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso8601_utc("2024-01-01T00:00:00Z"), Some(1_704_067_200));
        assert_eq!(parse_iso8601_utc("2026-07-08T12:34:56Z"), Some(1_783_514_096));
    }

    #[test]
    fn format_reset_time_variants() {
        assert_eq!(format_reset_time(None), "N/A");
        assert_eq!(format_reset_time(Some("not-a-date")), "not-a-date");
        assert_eq!(format_reset_time(Some("1970-01-01T00:00:00Z")), "Now"); // long past
    }

    #[test]
    fn format_delta_variants() {
        assert_eq!(format_delta(-5), "Now");
        assert_eq!(format_delta(600), "10m");
        assert_eq!(format_delta(90 * 60), "1h 30m");
    }

    #[test]
    fn strips_markdown_links() {
        assert_eq!(strip_markdown_link("[Claude Opus 4.5](/docs/opus)"), "Claude Opus 4.5");
        assert_eq!(strip_markdown_link("Plain text"), "Plain text");
    }

    #[test]
    fn extracts_five_mtok_prices_in_order() {
        let line = "| [Claude Opus 4.5](/x) | $5/MTok | - | - | $25 / MTok |";
        // Only 2 prices here on purpose — real rows have 5; this checks order/parsing, not the row filter.
        assert_eq!(extract_mtok_prices(line), vec![5.0, 25.0]);
    }

    #[test]
    fn parses_pricing_table_and_skips_excluded_rows() {
        let text = "\
| Model | Input | Cache write (5m) | Cache write (1h) | Cache read | Output |
|---|---|---|---|---|---|
| [Claude Opus 4.5](/x) | $5/MTok | $6.25/MTok | $10/MTok | $0.5/MTok | $25/MTok |
| [Claude Haiku](/x) | $0.25/MTok | $0.3/MTok | $0.5/MTok | $0.03/MTok | $1.25/MTok |
| [Claude Opus 3 (deprecated)](/x) | $15/MTok | $18.75/MTok | $30/MTok | $1.5/MTok | $75/MTok |
";
        let table = parse_pricing_table(text);
        assert_eq!(table["opus"], serde_json::json!({ "in": 5.0, "out": 25.0 }));
        assert_eq!(table["haiku"], serde_json::json!({ "in": 0.25, "out": 1.25 }));
        assert!(!table.contains_key("sonnet"));
    }

    #[test]
    fn crosses_threshold_variants() {
        assert_eq!(crosses_threshold(85.0, 80.0, false), (true, true)); // fresh crossing
        assert_eq!(crosses_threshold(85.0, 80.0, true), (false, true)); // already notified, stays armed
        assert_eq!(crosses_threshold(70.0, 80.0, true), (false, false)); // drops back under, re-arms
        assert_eq!(crosses_threshold(70.0, 80.0, false), (false, false)); // under threshold, stays unarmed
    }
}

//! Live CPU/memory/network sampling for the `system` module.
//!
//! A persistent `MonitorState` lives in Tauri managed state: sysinfo computes
//! CPU % and network byte counts as deltas since the previous refresh, so the
//! instances must survive across invokes — fresh ones per call would always
//! report 0. The webview polls this command every 1–2s (see
//! src/modules/system/sampler.ts).

use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Networks, System};
use tauri::State;

pub struct SystemMonitor(Mutex<MonitorState>);

impl SystemMonitor {
    pub fn new() -> Self {
        SystemMonitor(Mutex::new(MonitorState::new()))
    }
}

struct MonitorState {
    sys: System,
    networks: Networks,
    /// When the network counters were last drained — turns delta bytes into bytes/sec.
    last_net_refresh: Instant,
}

impl MonitorState {
    fn new() -> Self {
        MonitorState {
            sys: System::new(),
            networks: Networks::new_with_refreshed_list(),
            last_net_refresh: Instant::now(),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatsPayload {
    cpu_percent: f32,
    mem_used_bytes: u64,
    mem_total_bytes: u64,
    net_rx_bytes_per_sec: f64,
    net_tx_bytes_per_sec: f64,
}

fn sample(state: &mut MonitorState) -> SystemStatsPayload {
    state.sys.refresh_cpu_usage();
    state.sys.refresh_memory();

    state.networks.refresh(true);
    let elapsed = state.last_net_refresh.elapsed().as_secs_f64();
    state.last_net_refresh = Instant::now();
    // Sum all real interfaces; loopback ("lo0" on macOS) is chatter, not traffic.
    let (rx, tx) = state
        .networks
        .iter()
        .filter(|(name, _)| !name.starts_with("lo"))
        .fold((0u64, 0u64), |(rx, tx), (_, data)| {
            (rx + data.received(), tx + data.transmitted())
        });
    let per_sec = |bytes: u64| if elapsed > 0.0 { bytes as f64 / elapsed } else { 0.0 };

    SystemStatsPayload {
        cpu_percent: state.sys.global_cpu_usage(),
        mem_used_bytes: state.sys.used_memory(),
        mem_total_bytes: state.sys.total_memory(),
        net_rx_bytes_per_sec: per_sec(rx),
        net_tx_bytes_per_sec: per_sec(tx),
    }
}

#[tauri::command]
pub fn system_stats(monitor: State<'_, SystemMonitor>) -> Result<SystemStatsPayload, String> {
    let mut state = monitor.0.lock().map_err(|e| e.to_string())?;
    Ok(sample(&mut state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_reports_plausible_memory_cpu_and_network() {
        let mut state = MonitorState::new();
        let first = sample(&mut state);
        assert!(first.mem_total_bytes > 0, "total memory should be > 0");
        assert!(first.mem_used_bytes <= first.mem_total_bytes);

        // CPU % is a delta between refreshes; wait sysinfo's minimum interval
        // so the second sample is meaningful.
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL + std::time::Duration::from_millis(50));
        let second = sample(&mut state);
        assert!((0.0..=100.0).contains(&second.cpu_percent), "cpu% out of range: {}", second.cpu_percent);
        assert!(second.net_rx_bytes_per_sec.is_finite() && second.net_rx_bytes_per_sec >= 0.0);
        assert!(second.net_tx_bytes_per_sec.is_finite() && second.net_tx_bytes_per_sec >= 0.0);
    }

    /// Pins the serde camelCase field names the TS `SystemStatsPayload` type
    /// depends on — a rename here would silently break the frontend.
    #[test]
    fn sample_serializes_with_expected_camel_case_keys() {
        let mut state = MonitorState::new();
        let value = serde_json::to_value(sample(&mut state)).expect("payload should serialize");
        let keys: std::collections::BTreeSet<&str> =
            value.as_object().expect("payload should be a JSON object").keys().map(String::as_str).collect();
        let expected: std::collections::BTreeSet<&str> =
            ["cpuPercent", "memUsedBytes", "memTotalBytes", "netRxBytesPerSec", "netTxBytesPerSec"]
                .into_iter()
                .collect();
        assert_eq!(keys, expected);
    }
}

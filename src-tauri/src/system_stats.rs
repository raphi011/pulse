//! Live CPU/memory sampling for the `system` module.
//!
//! A persistent `sysinfo::System` lives in Tauri managed state: sysinfo
//! computes CPU % as a delta since the previous refresh, so the instance must
//! survive across invokes — a fresh `System` per call would always report 0%.
//! The webview polls this command every 1–2s (see src/modules/system/sampler.ts).

use std::sync::Mutex;
use sysinfo::System;
use tauri::State;

pub struct SystemMonitor(Mutex<System>);

impl SystemMonitor {
    pub fn new() -> Self {
        SystemMonitor(Mutex::new(System::new()))
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatsPayload {
    cpu_percent: f32,
    mem_used_bytes: u64,
    mem_total_bytes: u64,
}

fn sample(sys: &mut System) -> SystemStatsPayload {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    SystemStatsPayload {
        cpu_percent: sys.global_cpu_usage(),
        mem_used_bytes: sys.used_memory(),
        mem_total_bytes: sys.total_memory(),
    }
}

#[tauri::command]
pub fn system_stats(monitor: State<'_, SystemMonitor>) -> Result<SystemStatsPayload, String> {
    let mut sys = monitor.0.lock().map_err(|e| e.to_string())?;
    Ok(sample(&mut sys))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_reports_plausible_memory_and_cpu() {
        let mut sys = System::new();
        let first = sample(&mut sys);
        assert!(first.mem_total_bytes > 0, "total memory should be > 0");
        assert!(first.mem_used_bytes <= first.mem_total_bytes);

        // CPU % is a delta between refreshes; wait sysinfo's minimum interval
        // so the second sample is meaningful.
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL + std::time::Duration::from_millis(50));
        let second = sample(&mut sys);
        assert!((0.0..=100.0).contains(&second.cpu_percent), "cpu% out of range: {}", second.cpu_percent);
    }

    /// Pins the serde camelCase field names the TS `SystemStatsPayload` type
    /// depends on — a rename here would silently break the frontend.
    #[test]
    fn sample_serializes_with_expected_camel_case_keys() {
        let mut sys = System::new();
        let value = serde_json::to_value(sample(&mut sys)).expect("payload should serialize");
        let keys: std::collections::BTreeSet<&str> =
            value.as_object().expect("payload should be a JSON object").keys().map(String::as_str).collect();
        let expected: std::collections::BTreeSet<&str> =
            ["cpuPercent", "memUsedBytes", "memTotalBytes"].into_iter().collect();
        assert_eq!(keys, expected);
    }
}

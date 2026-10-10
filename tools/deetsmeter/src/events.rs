//! The event record. Every part pushes a JSON object with a `t` (µs, clock.rs) and an `ev`.
//! Events are held in memory and written once at the end, so no file I/O runs while the
//! sensor is timing anything.

use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::Mutex;

pub struct Events {
    list: Mutex<Vec<Value>>,
}

impl Events {
    pub fn new() -> Self {
        Events { list: Mutex::new(Vec::with_capacity(16_384)) }
    }

    /// Push one event. `body` must be a JSON object; `t` and `ev` are added to it.
    pub fn push(&self, t: i64, ev: &str, body: Value) {
        let mut v = if body.is_object() { body } else { json!({}) };
        v["t"] = json!(t);
        v["ev"] = json!(ev);
        self.list.lock().unwrap().push(v);
    }

    pub fn snapshot(&self) -> Vec<Value> {
        self.list.lock().unwrap().clone()
    }

    /// Write every event as one JSON line, ordered by time.
    pub fn write(&self, path: &Path) -> std::io::Result<usize> {
        let mut all = self.snapshot();
        all.sort_by_key(|v| v["t"].as_i64().unwrap_or(0));
        let mut w = BufWriter::new(File::create(path)?);
        for v in &all {
            serde_json::to_writer(&mut w, v)?;
            w.write_all(b"\n")?;
        }
        w.flush()?;
        Ok(all.len())
    }
}

//! Budget period dates and tab labels (English month abbrev per product spec).

use chrono::{Datelike, NaiveDate};

pub fn parse_iso(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| {
        format!("Invalid date '{s}' — use YYYY-MM-DD")
    })
}

/// Unique storage key for `budget_months.year_month` (not shown raw in UI).
pub fn period_slug(start: &str, end: &str) -> String {
    let a = start.trim();
    let b = end.trim();
    if a == b {
        return a.to_string();
    }
    format!("{a}__{b}")
}

pub fn is_full_calendar_month(start: NaiveDate, end: NaiveDate) -> bool {
    if start.year() != end.year() || start.month() != end.month() {
        return false;
    }
    if start.day() != 1 {
        return false;
    }
    let last = last_day_of_month(start.year(), start.month());
    end.day() == last
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let first_next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .unwrap();
    first_next.pred_opt().map(|d| d.day()).unwrap_or(31)
}

/// e.g. full month April 2026 → "APR '26"; otherwise "4/1–4/15 '26"
pub fn format_tab_label(period_start: &str, period_end: &str) -> String {
    let Ok(s) = parse_iso(period_start) else {
        return period_start.to_string();
    };
    let Ok(e) = parse_iso(period_end) else {
        return period_end.to_string();
    };
    if is_full_calendar_month(s, e) {
        let m = (s.month0() as usize).min(11);
        const M: [&str; 12] = [
            "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
        ];
        let yy = s.year() % 100;
        return format!("{} '{:02}", M[m], yy);
    }
    format!(
        "{}/{}–{}/{} '{}",
        s.month(),
        s.day(),
        e.month(),
        e.day(),
        e.year() % 100
    )
}

pub fn full_month_bounds(year: i32, month: u32) -> Result<(String, String), String> {
    let start = NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| "Invalid month".to_string())?;
    let last = last_day_of_month(year, month);
    let end = NaiveDate::from_ymd_opt(year, month, last).ok_or_else(|| "Invalid month".to_string())?;
    Ok((start.format("%Y-%m-%d").to_string(), end.format("%Y-%m-%d").to_string()))
}

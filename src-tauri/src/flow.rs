//! FlowJo track — FCS reading via the `flow-fcs` crate (seq 440, F0).
//!
//! Verdict: ADOPT `flow-fcs` 0.6.0 (MIT), pinned exact — see
//! `docs/flow-fcs-evaluation.md` for the evidence, the corpus, and the
//! conditions. The module is opt-in and off by default: nothing here is
//! wired into a menu, a command, or MCP yet — Phase 1 owns the event
//! store and the `titer_import_fcs` surface. This file currently holds
//! only the headless smoke test that pins the adoption: it opens real
//! FCS fixtures through the crate and asserts $PAR / $TOT / parameter
//! names / first event values, re-derived independently in Python
//! (see the evaluation doc).
//!
//! Conditions carried from the evaluation (do not silently drop them):
//! - The crate's `Biexponential` is arcsinh with the width ignored —
//!   never use it as FlowJo's logicle (Phase 2 owns the real Parks
//!   logicle).
//! - `Fcs::open` requires a `.fcs` extension; stage other names first.
//! - 24/8/64-bit int and ASCII data are rejected by the crate's decoder.
//! - `$BYTEORD "1,2"` / `"2,1"` short forms do not parse.

#[cfg(test)]
mod tests {
    use flow_fcs::Fcs;

    fn fixture(name: &str) -> String {
        format!(
            "{}/../tests/testdata/fcs/{}",
            env!("CARGO_MANIFEST_DIR"),
            name
        )
    }

    #[test]
    fn flow_fcs_smoke_opens_real_fcs_file() {
        // Gating-ML compliance fixture: FCS 3.0, big-endian int16,
        // 6 params, 10 events. Expected values re-derived in Python
        // from the fixture bytes (docs/flow-fcs-evaluation.md).
        let fcs = Fcs::open(&fixture("int-10_events_6_parameters.fcs"))
            .expect("flow-fcs must open the smoke fixture");
        assert_eq!(*fcs.get_number_of_parameters().expect("$PAR"), 6);
        assert_eq!(*fcs.get_number_of_events().expect("$TOT"), 10);
        assert_eq!(
            fcs.get_parameter_names_from_dataframe(),
            vec!["AS", "BS", "CS", "DS", "ES", "FS"]
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>()
        );
        // First event, decoded big-endian int16: 10, 20, 30, 40, 50, 60.
        let first = fcs
            .get_parameter_events_slice("AS")
            .expect("AS column must decode");
        assert_eq!(first.len(), 10);
        assert_eq!(first[0], 10.0);
        let last = fcs
            .get_parameter_events_slice("FS")
            .expect("FS column must decode");
        assert_eq!(last[0], 60.0);
    }

    #[test]
    fn flow_fcs_smoke_minimal_file_and_spillover_fixture() {
        let tiny = Fcs::open(&fixture("int-gating_test_file.fcs"))
            .expect("flow-fcs must open the 1-event fixture");
        assert_eq!(*tiny.get_number_of_parameters().expect("$PAR"), 2);
        assert_eq!(*tiny.get_number_of_events().expect("$TOT"), 1);
        assert_eq!(
            tiny.get_parameter_names_from_dataframe(),
            vec!["FS", "SS"]
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>()
        );
        let fs = tiny
            .get_parameter_events_slice("FS")
            .expect("FS column must decode");
        assert_eq!(fs, &[100.0]);

        // Hand-built FCS 3.1 fixture: float32 LE, 3 params, 4 events,
        // $SPILLOVER 3x3. Pins the compensation entry point too.
        let spill = Fcs::open(&fixture("synth-spill.fcs"))
            .expect("flow-fcs must open the spillover fixture");
        assert_eq!(*spill.get_number_of_parameters().expect("$PAR"), 3);
        assert_eq!(*spill.get_number_of_events().expect("$TOT"), 4);
        let (matrix, channels) = spill
            .get_spillover_matrix()
            .expect("spillover must parse")
            .expect("spillover must be present");
        assert_eq!((matrix.nrows(), matrix.ncols()), (3, 3));
        assert_eq!(
            channels,
            vec!["FL1-A", "FL2-A", "FL3-A"]
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>()
        );
        let compensated = spill
            .apply_file_compensation()
            .expect("file compensation must apply");
        assert_eq!((compensated.height(), compensated.width()), (4, 3));
    }
}

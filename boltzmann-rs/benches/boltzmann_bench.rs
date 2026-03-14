use criterion::{black_box, criterion_group, criterion_main, Criterion};

use boltzmann_rs::analyze::analyze;

/// 5x5 perfect CoinJoin (Whirlpool-like): 1,496 combinations
fn bench_5x5_perfect_cj(c: &mut Criterion) {
    c.bench_function("5x5_perfect_cj", |b| {
        b.iter(|| {
            analyze(
                black_box(&[5, 5, 5, 5, 5]),
                black_box(&[5, 5, 5, 5, 5]),
                black_box(0),
                black_box(0.0),
                black_box(60_000),
            )
        });
    });
}

/// 7x7 perfect CoinJoin: 426,833 combinations
fn bench_7x7_perfect_cj(c: &mut Criterion) {
    c.bench_function("7x7_perfect_cj", |b| {
        b.iter(|| {
            analyze(
                black_box(&[5, 5, 5, 5, 5, 5, 5]),
                black_box(&[5, 5, 5, 5, 5, 5, 5]),
                black_box(0),
                black_box(0.0),
                black_box(60_000),
            )
        });
    });
}

/// 9-in 4-out mixed tx with intrafees: 438 combinations
fn bench_9in_4out_mixed(c: &mut Criterion) {
    c.bench_function("9in_4out_mixed", |b| {
        b.iter(|| {
            analyze(
                black_box(&[203486, 5_000_000, 11126, 9829, 9_572_867, 13796, 150000, 82835, 5_000_000]),
                black_box(&[791116, 907419, 9_136_520, 9_136_520]),
                black_box(72364),
                black_box(0.005),
                black_box(60_000),
            )
        });
    });
}

/// 6-in 2-out consolidation: 1 combination (degenerate)
fn bench_consolidation(c: &mut Criterion) {
    c.bench_function("6in_2out_consolidation", |b| {
        b.iter(|| {
            analyze(
                black_box(&[5_300_000_000, 2_020_000_000, 4_975_000_000, 5_000_000_000, 5_556_000_000, 7_150_000_000]),
                black_box(&[1_000_000, 30_000_000_000]),
                black_box(0),
                black_box(0.0),
                black_box(60_000),
            )
        });
    });
}

/// 2-in 4-out DarkWallet CoinJoin: 4 combinations
fn bench_2in_4out_cj(c: &mut Criterion) {
    c.bench_function("2in_4out_darkwallet", |b| {
        b.iter(|| {
            analyze(
                black_box(&[100_000_000, 200_000_000]),
                black_box(&[80_000_000, 20_000_000, 80_000_000, 120_000_000]),
                black_box(0),
                black_box(0.0),
                black_box(60_000),
            )
        });
    });
}

/// 8x8 perfect CoinJoin: 9,934,563 combinations (heavy workload)
fn bench_8x8_perfect_cj(c: &mut Criterion) {
    let mut group = c.benchmark_group("heavy");
    group.sample_size(10); // fewer samples since each run is slow
    group.bench_function("8x8_perfect_cj", |b| {
        b.iter(|| {
            analyze(
                black_box(&[5, 5, 5, 5, 5, 5, 5, 5]),
                black_box(&[5, 5, 5, 5, 5, 5, 5, 5]),
                black_box(0),
                black_box(0.0),
                black_box(300_000),
            )
        });
    });
    group.finish();
}

/// 9x9 perfect CoinJoin: 277,006,192 combinations (very heavy)
fn bench_9x9_perfect_cj(c: &mut Criterion) {
    let mut group = c.benchmark_group("very_heavy");
    group.sample_size(10);
    group.measurement_time(std::time::Duration::from_secs(30));
    group.bench_function("9x9_perfect_cj", |b| {
        b.iter(|| {
            analyze(
                black_box(&[5, 5, 5, 5, 5, 5, 5, 5, 5]),
                black_box(&[5, 5, 5, 5, 5, 5, 5, 5, 5]),
                black_box(0),
                black_box(0.0),
                black_box(600_000),
            )
        });
    });
    group.finish();
}

criterion_group!(
    benches,
    bench_consolidation,
    bench_2in_4out_cj,
    bench_5x5_perfect_cj,
    bench_7x7_perfect_cj,
    bench_9in_4out_mixed,
    bench_8x8_perfect_cj,
    bench_9x9_perfect_cj,
);
criterion_main!(benches);

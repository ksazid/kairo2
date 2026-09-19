# VS-03 Semantic Retrieval Benchmark

Status: DEC-003 approved; PgVector is promoted for Kairo V1 semantic retrieval.

## Corrected fail-closed run

- Decision evidence candidate: `b0995b0630515d9435c4c13f7e52b766cd42d4d4`.
- GitHub Actions CI run: `31662100800`.
- The benchmark shell uses `set -o pipefail`; a benchmark process failure cannot be masked by `tee`.
- Deterministic surrogate: 384 dimensions, 6 Brands, 1,200 vectors per Brand, 7,200 total vectors, 24 queries, topK 10, seed `0x4b414952`.
- Every query applies explicit Workspace + Brand filtering; tenant leak count must be zero.

## Results

| Metric | PgVector 0.8.6 | Qdrant 1.18 + TurboQuant |
| --- | ---: | ---: |
| recall@10 | 1.0000 | 1.0000 |
| tenant leaks | 0 | 0 |
| p50 query latency | 0.96 ms | 44.00 ms |
| p95 query latency | 1.30 ms | 44.95 ms |
| insert time | 956.32 ms | 1,294.49 ms |

PgVector configuration: HNSW `m=16`, `ef_construction=100`, `ef_search=200`, `hnsw.iterative_scan=strict_order`, `hnsw.max_scan_tuples=20000`.

Qdrant configuration: HNSW `ef=80`, TurboQuant bits4 default, oversampling 2, rescoring enabled, Brand payload tenant index enabled.

PgVector relation size for the benchmark was 26,828,800 bytes. Qdrant reported all 7,200 points indexed. The benchmark does not claim cross-provider storage equivalence because the Qdrant container metric available in the run is not directly comparable to PostgreSQL relation bytes.

## Interpretation

Both providers satisfy the benchmark's recall and tenant-isolation floor after PgVector is correctly tuned for filtered HNSW retrieval. On this V1-sized representative surrogate, PgVector is materially faster while avoiding an additional vector-service operational dependency because PostgreSQL is already Kairo's authoritative store.

Qdrant + TurboQuant remains strategically attractive for substantially larger vector-memory workloads, specialized vector operations and compression. Kairo therefore keeps the semantic retrieval boundary provider-neutral and will re-benchmark Qdrant + TurboQuant when corpus size, latency, concurrency or memory pressure justifies a scale-up evaluation.

## DEC-003

**Approved decision:** use **PgVector for Kairo V1 semantic retrieval**, behind the provider-neutral semantic retrieval boundary. PostgreSQL remains authoritative for Kairo domain truth. Qdrant + TurboQuant remains the approved scale-up candidate/fallback evaluation path and is not a V1 production dependency.

Approved by Sazid Khan on 2026-08-13 after reviewing the corrected benchmark and the daily Hunter/coverage-memory workload.

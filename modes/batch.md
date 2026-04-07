# Modo: batch - Procesamiento Masivo de Ofertas

Este modo cubre dos caminos:

1. **Conductor interactivo**: el usuario navega portales y Codex va acumulando URLs.
2. **Script standalone**: `batch/batch-runner.mjs` procesa `batch-input.tsv` con workers de `codex exec`.

## Arquitectura

```text
Codex conductor
  |
  | lee portales o input ya reunido
  |
  +-> batch-input.tsv
  +-> batch/batch-runner.mjs
         |
         +-> codex exec worker
         +-> codex exec worker
         +-> codex exec worker
                |
                +-> report .md
                +-> PDF
                +-> tracker line TSV
                +-> JSON final
```

## Archivos

```text
batch/
  batch-input.tsv
  batch-state.tsv
  batch-runner.mjs
  batch-prompt.md
  logs/
  tracker-additions/
```

## Flujo

1. Leer `batch/batch-state.tsv` para saber que ya se proceso.
2. Para cada URL pendiente:
   - capturar o reutilizar JD
   - reservar `report_num`
   - resolver placeholders en `batch/batch-prompt.md`
   - ejecutar un worker con `codex exec`
   - guardar log y JSON final
   - actualizar `batch-state.tsv`
3. Al final:
   - correr `node merge-tracker.mjs`
   - correr `node verify-pipeline.mjs`
   - mostrar resumen

## Script Standalone

```bash
node batch/batch-runner.mjs [OPTIONS]
```

Opciones:
- `--dry-run`
- `--retry-failed`
- `--start-from N`
- `--parallel N`
- `--max-retries N`

## Estado y Resumabilidad

- `batch-state.tsv` es la fuente de verdad para progreso y retries.
- Si el proceso muere, se puede re-ejecutar y saltar ofertas completadas.
- Un lock file evita ejecuciones dobles del batch runner.
- Cada worker es independiente.

## Workers

Cada worker recibe un prompt resuelto desde `batch/batch-prompt.md`. Debe producir:

1. un report en `reports/`
2. un PDF en `output/`
3. una linea TSV en `batch/tracker-additions/`
4. un JSON final que el runner pueda parsear

## Reglas

- Mantener los estados canonicamente en ingles: `Evaluated`, `Applied`, `Responded`, `Interview`, `Offer`, `Rejected`, `Discarded`, `SKIP`
- No editar `data/applications.md` directamente para nuevas filas
- Si no se puede verificar una oferta con navegador real, marcarla como no confirmada en vez de asumir que sigue abierta

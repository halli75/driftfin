# Modo: tracker - Tracker de Aplicaciones

Lee y muestra `data/applications.csv`.

Columnas clave:
- `application_id`
- `company`
- `position`
- `status`
- `score`
- `grade`
- `report_path`
- `custom_resume_path`
- `application_successful`

Estados posibles: `discovered` -> `evaluated` -> `applying` -> `applied` / `blocked` / `failed` / `closed` / `duplicate`

Si el usuario pide actualizar un estado, editar la fila correspondiente en el CSV canonico.

Mostrar tambien estadisticas:
- Total de aplicaciones
- Por estado
- Score promedio
- % con CV adaptado
- % con report generado

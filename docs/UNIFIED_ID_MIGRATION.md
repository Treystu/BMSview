# Unified Hardware ID Migration

**Date:** January 2026
**Status:** Completed

## Overview

The BMSview application historically used inconsistent naming for hardware identifiers:
- `dlNumber` (Data Logger Number)
- `hardwareId`
- `associatedDLs` (Array of IDs on a System)

This created confusion and data fragmentation. We have unified everything under **Hardware System ID**.

## New Standard

1.  **`hardwareSystemId`**: The single source of truth for a record's physical ID.
    *   Format: `DL-XXXXXX` (Normalized: Uppercase, Dashes preserved).
2.  **`associatedHardwareIds`**: The array of IDs linked to a registered System.

## Deprecations

The following fields are **DEPRECATED** and should not be used in new logic:
- `dlNumber` -> Use `hardwareSystemId`
- `associatedDLs` -> Use `associatedHardwareIds`

## Migration Logic

- **Database**: Existing records retain legacy fields.
- **Backend**:
    - Writes: Syncs both fields (`associatedHardwareIds` = `associatedDLs`) to ensure backward compatibility.
    - Reads: Checks all fields (`hardwareSystemId` || `dlNumber`) to ensure no data is lost.
- **Frontend**:
    - UI only displays `associatedHardwareIds`.
    - Registration only sends `associatedHardwareIds`.

## Normalization Rules

All Hardware IDs are normalized via `normalizeHardwareId()` in `analysis-helpers.cjs`:
- Trims whitespace
- Converts to Uppercase
- Replaces spaces/underscores with dashes
- Ensures a dash exists after the letter prefix (e.g., `DL123` -> `DL-123`)

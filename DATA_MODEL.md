# BMSview Data Model & Variable Master List

This document serves as the single source of truth for the variable naming conventions and data model used across the BMSview application. The goal is to unify terminology, specifically regarding System IDs and Hardware Identifiers, to prevent confusion and ensuring consistent linking.

## 1. Core Concepts

### 1.1. System Entity (`BmsSystem`)

Represents a configured battery system (e.g., "Main Van Battery").

- **Unique Identifier**: `id` (UUID v4). This is the internal primary key used for relationships in the database.
  - _Variable Name_: `systemId` (when referencing a system), `id` (on the system object itself).
- **Hardware Identifiers**: A system can be associated with one or more physical devices.
  - **primary field**: `associatedHardwareIds` (Array of strings).
  - **legacy field (DEPRECATED)**: `associatedDLs` (Array of strings). Do not use in new code.
  - _Rule_: `associatedHardwareIds` is the Source of Truth.

### 1.2. Analysis Record (`AnalysisRecord`)

Represents a single parsed BMS screenshot or data point.

- **Unique Identifier**: `id` (UUID v4 or MongoDB ObjectId).
- **Link to System**:
  - `systemId`: The UUID of the `BmsSystem` this record belongs to.
- **Hardware Source ID**: The identifier extracted from the image/upload that identifies the physical device.
  - **primary field**: `hardwareSystemId` (String).
  - **legacy field (DEPRECATED)**: `dlNumber` (String). Do not use in new code.
  - _Rule_: `hardwareSystemId` is the Source of Truth. If a legacy record is updated, migrate `dlNumber` to `hardwareSystemId`.

## 2. Variable Dictionary

| Variable / Field Name   | Context         | Type          | Definition / Usage                                                                                                                                       |
| :---------------------- | :-------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemId`              | Global          | UUID (String) | The primary key of a System in the `systems` collection. Used in `history` records to link them to a system. **This is NOT the hardware serial number.** |
| `hardwareSystemId`      | Analysis Record | String        | The physical identifier (e.g., "DL12345", "BT-A789") extracted from the device screen. Used to look up the correct `systemId`.                           |
| `dlNumber`              | Analysis Record | String        | **DEPRECATED**. Legacy field. Do not use. Use `hardwareSystemId`.                                                                                        |
| `associatedHardwareIds` | System Entity   | String[]      | List of physical IDs (like `hardwareSystemId`) that belong to this system. **Source of Truth**.                                                          |
| `associatedDLs`         | System Entity   | String[]      | **DEPRECATED**. Legacy field. Do not use. Use `associatedHardwareIds`.                                                                                   |
| `fileName`              | Analysis Record | String        | The original filename of the uploaded screenshot.                                                                                                        |
| `analysis`              | Analysis Record | Object        | Contains the raw data extracted from Gemini (e.g., voltage, current, SOC).                                                                               |
| `weather`               | Analysis Record | Object        | Contains weather data associated with the record's timestamp and location.                                                                               |
| `timestamp`             | Global          | ISO String    | The time the record occurred (UTC).                                                                                                                      |

## 3. Unification Rules (The "Forever" Rules)

1. **Always use `systemId` for Relations**: When linking a record to a system in the database, frontend, or API, ALWAYS use the System's UUID (`systemId`). Never link using the hardware ID string directly as a foreign key.
2. **Hardware ID Source of Truth**:
   - ALWAYS read/write to `hardwareSystemId` on records.
   - ALWAYS read/write to `associatedHardwareIds` on Systems.
   - **Do not** explicitly populate `dlNumber` or `associatedDLs` in new code. The backend may maintain them for temporary backwards compatibility, but they are dead fields.
3. **Auto-Association Priority**:
   - First, try to match the record's `hardwareSystemId` against a System's `id` (Direct UUID match).
   - Second, try to match against the System's `associatedHardwareIds` list.

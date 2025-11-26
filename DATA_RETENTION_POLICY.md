# Data Retention Policy

## Overview
This document outlines the data retention policies for the BMSview application, specifically regarding AI-generated insights and user feedback.

## AI Insights Data
- **Retention Period:** 30 days
- **Data Type:** Background job records for AI analysis (inputs, intermediate steps, and final insights).
- **Storage:** MongoDB `insights-jobs` collection.
- **Mechanism:** Automatic deletion via MongoDB TTL (Time-To-Live) index on the `createdAt` field.
- **Purpose:** To allow users to retrieve async analysis results and support resume/retry functionality for failed jobs. After 30 days, the data is considered stale and is permanently removed to minimize storage costs and privacy risks.

## User Data (BMS Analysis)
- **Retention Period:** Indefinite (until user deletion)
- **Data Type:** Uploaded BMS screenshots and extracted analysis data.
- **Storage:** MongoDB `history` collection.
- **Mechanism:** Manual deletion by user or admin.
- **Purpose:** Historical tracking of battery performance.

## Anonymization
- **AI Processing:** All system profiles sent to AI services (Gemini) are anonymized in-memory before transmission.
  - System IDs are hashed.
  - Names are replaced with generic identifiers.
  - Location coordinates are rounded to 2 decimal places (~1km accuracy).
  - PII fields (email, phone, address) are stripped.

## Compliance
These policies are designed to comply with GDPR and other data privacy regulations by minimizing data retention and ensuring user control over their data.
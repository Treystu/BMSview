# GDPR Compliance Statement

## Overview
BMSview is committed to protecting user privacy and complying with the General Data Protection Regulation (GDPR). This document outlines our data processing activities and compliance measures.

## Data Processing Activities

### 1. AI Insights Generation
- **Purpose:** To provide users with intelligent analysis of their battery management system (BMS) data.
- **Data Processed:**
  - Battery voltage, current, SOC, temperature, and alerts.
  - Anonymized system profile (hashed ID, generic name, blurred location).
- **Third-Party Processors:**
  - **Google Gemini (AI Service):** Receives *anonymized* context data to generate textual insights. No PII is shared.
- **Legal Basis:** User Consent (Article 6(1)(a)). Users must explicitly opt-in via a checkbox before AI analysis is performed.

### 2. Historical Data Storage
- **Purpose:** To allow users to track their battery performance over time.
- **Data Processed:** BMS screenshots and extracted numerical data.
- **Legal Basis:** Legitimate Interests (Article 6(1)(f)) - essential for the core functionality of the app.

## User Rights

### Right to Access (Article 15)
Users can view all their stored data via the application dashboard.

### Right to Erasure ("Right to be Forgotten") (Article 17)
- Users can delete individual analysis records or their entire history via the application settings.
- AI insight jobs are automatically deleted after 30 days.

### Right to Rectification (Article 16)
Users can edit system profiles and correct extracted data values.

## Data Protection Measures

### Anonymization
- All data sent to AI services is stripped of Personally Identifiable Information (PII).
- System IDs are hashed to prevent direct linkage back to user accounts by third parties.
- Location data is rounded to reduce precision while maintaining utility for weather lookup.

### Data Retention
- Strict 30-day retention policy for AI processing jobs.
- Automated cleanup using database Time-To-Live (TTL) indexes.

### Consent Management
- Granular consent mechanism for AI features.
- Clear explanation of data usage at the point of collection.

## Contact
For privacy-related inquiries, please open an issue in the GitHub repository.
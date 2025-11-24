# GEMINI Project Guidelines: BMSview

This document provides a comprehensive guide for agents working on the BMSview project. It covers the project's architecture, development practices, and key operational details to ensure consistent and high-quality contributions.

## 1. Project Overview

BMSview is an advanced web application for analyzing Battery Management System (BMS) screenshots. It leverages Google's Gemini AI to provide users with detailed insights into their battery performance. The application also integrates solar energy estimation and battery charging correlation features.

### 1.1. Core Features
- **AI-Powered Screenshot Analysis**: Users can upload BMS screenshots for automated analysis.
- **Historical Performance Tracking**: The application stores and displays historical battery data.
- **BMS System Management**: Users can register and manage multiple BMS systems.
- **Interactive Data Visualization**: Data is presented through interactive charts and graphs.
- **Solar Integration**: Provides solar energy generation estimates and correlates them with battery charging data.
- **"Ultimate AI Battery Guru"**: A context-aware AI assistant that provides rich insights based on system analytics, forecasts, and historical data.

### 1.2. Technology Stack
- **Frontend**: React, Vite, TypeScript, Tailwind CSS
- **Backend**: Netlify Functions (Node.js/TypeScript)
- **Database**: MongoDB
- **AI**: Google Gemini (specifically Gemini 2.5 Flash)
- **APIs**: Solar Charge Estimator API, OpenWeather API
- **Authentication**: Netlify Identity

## 2. System Architecture

BMSview is built on a **local-first sync architecture**. This design prioritizes offline functionality and minimizes server load by using intelligent caching and periodic synchronization.

### 2.1. Key Architectural Principles
1.  **Local-First**: Data is primarily stored in the browser's IndexedDB. The server acts as the authoritative source for conflict resolution.
2.  **Intelligent Sync**: Synchronization is driven by metadata comparison (timestamps, record counts) rather than on every operation.
3.  **Periodic Sync**: A background timer syncs data every 90 seconds, with manual triggers on critical actions.
4.  **Dual-Write for Critical Actions**: Important user actions (e.g., new analysis) are written to both the local cache and the server immediately.
5.  **UTC Timestamps**: All timestamps use the ISO 8601 UTC format (`YYYY-MM-DDTHH:mm:ss.sssZ`).

### 2.2. Core Components
- **`SyncManager` (`src/services/syncManager.ts`)**: Orchestrates the entire sync process, including periodic scheduling and decision-making.
- **`LocalCache` (`src/services/localCache.ts`)**: Manages the IndexedDB storage using Dexie.js, handling data persistence and sync status tracking.
- **`ClientService` (`services/clientService.ts`)**: An API wrapper that implements the cache-first data fetching strategy.
- **`AppState` (`state/appState.tsx`)**: The global React state, managed with `useReducer` and `useContext`, which includes sync status fields.
- **Netlify Sync Functions (`netlify/functions/sync-*.cjs`)**: A set of serverless functions that handle the backend logic for metadata comparison, incremental data fetching, and data pushes.

### 2.3. Data Flow
- **Read Operations**: Follow a **cache-first** strategy. The application first attempts to read data from the local IndexedDB. If the data is not available locally, it fetches it from the server and populates the cache.
- **Critical Write Operations**: Use a **dual-write** pattern. The data is sent to the server and written to the local cache simultaneously. The sync timer is reset after these actions.
- **Periodic Sync**: Every 90 seconds, the `SyncManager` compares local metadata with server metadata to decide whether to push local changes, pull server changes, or do nothing.

### 2.4. Analysis Flows
- **Synchronous Flow (`/api/analyze?sync=true`)**: Used for single-file uploads to provide a fast user experience. The entire analysis is performed in a single serverless function invocation.
- **Asynchronous Flow (`/api/analyze`)**: Used for bulk uploads. The backend creates jobs for each file, and the frontend polls for completion status. **This flow is being deprecated in favor of the synchronous flow and local-first architecture.**

## 3. Development Setup

### 3.1. Prerequisites
- Node.js (v20 or later)
- An account with access to the project's Netlify and MongoDB resources.

### 3.2. Local Environment
1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Configure Environment Variables**: Create a `.env.local` file in the project root and add the following:
    ```
    GEMINI_API_KEY=your_gemini_api_key
    MONGODB_URI=your_mongodb_connection_string
    MONGODB_DB_NAME=your_database_name
    ```
3.  **Run the Development Server**:
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:5173`.

### 3.3. Important Scripts
- `npm run build`: Builds the application for production.
- `npm run preview`: Previews the production build locally.
- `npm test`: Runs the test suite.

## 4. Codebase Conventions and Best Practices

### 4.1. Module Systems
- **Frontend (`.ts`, `.tsx`)**: Use ES Modules (`import`/`export`).
- **Backend (`.cjs`)**: Use CommonJS (`require`/`module.exports`).
- **Do not mix module systems.**

### 4.2. Path Aliases
Use the configured path aliases (`components/*`, `services/*`, etc.) for imports within the frontend code to avoid long relative paths.

### 4.3. State Management
- Global state is managed using React's `useReducer` and `useContext` hooks.
- The main state logic is located in `state/appState.tsx` and `state/adminState.tsx`.

### 4.4. Error Handling & Logging
- Use the structured JSON logger from `utils/logger.cjs` for all server-side logging.
- Implement the retry wrappers from `utils/retry.cjs` for operations that interact with external services.
- Always return structured error responses from API endpoints.

### 4.5. Interacting with Gemini
- Use `process.env.GEMINI_MODEL` to specify the model, with a fallback to a default value.
- Implement strict timeouts: 25 seconds for iterations and 58 seconds for the total operation.
- Gracefully handle potential JSON parsing errors from the API response.

### 4.6. MongoDB Interactions
- Always use the `getCollection()` helper from `utils/mongodb.cjs` to interact with the database.
- Ensure all necessary indexes are created on the collections, as defined in `ARCHITECTURE.md` and `MONGODB_INDEXES.md`.

### 4.7. Anti-Patterns to Avoid
1.  **Do not create new job-based asynchronous flows.** The local-first sync architecture is the preferred model.
2.  **Do not use `require()` in the frontend code.**
3.  **Do not skip logging, especially on the backend.**
4.  **Do not hardcode AI model names.**
5.  **Do not mix module systems within the same part of the application.**

## 5. Contribution Guidelines

This repository is configured for contributions from both human developers and the GitHub Copilot Coding Agent.

### 5.1. For Human Contributors
1.  Create a feature branch from the `main` branch.
2.  Make your changes, adhering to the conventions outlined in this document.
3.  Ensure all tests pass (`npm test`) and the application builds successfully (`npm run build`).
4.  Submit a pull request with a clear description of the changes.

### 5.2. For AI Agent Contributors
- Detailed instructions for the agent are located in `.github/copilot-instructions.md`.
- When creating issues for the agent, provide clear context, acceptance criteria, and specify the files to be modified.

By adhering to these guidelines, we can maintain a clean, consistent, and high-quality codebase.
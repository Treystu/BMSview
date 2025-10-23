# Project Overview

This project is a web application for analyzing Battery Management System (BMS) screenshots. Users can upload images of their BMS and the application will analyze them using the Gemini AI model. The application has a public-facing side for users to upload and view their analysis results, and an admin section for managing the system.

**Main Technologies:**

*   **Frontend:** React, Vite, TypeScript, Tailwind CSS
*   **Backend:** Netlify Functions (Node.js)
*   **AI:** Google Gemini
*   **Database:** MongoDB (inferred from `netlify/functions/utils/mongodb.js`)
*   **Authentication:** Netlify Identity

**Architecture:**

The application is a single-page application (SPA) with two entry points: `index.html` for the public-facing side and `admin.html` for the admin section. The frontend is built with React and Vite. The backend is a set of serverless functions deployed on Netlify. These functions handle tasks such as image analysis, database operations, and user authentication.

# Logic Flows

## Analysis Process

The application supports two analysis flows: a synchronous flow for single-file uploads to provide a faster user experience, and an asynchronous flow for bulk uploads.

### Single-File Synchronous Flow

1.  **Upload:** The user uploads a single image file on the main page.
2.  **Request:** The frontend sends a request to the `/api/analyze?sync=true` endpoint.
3.  **Analysis:** The `analyze` function on the backend performs the following steps in a single invocation:
    *   Checks for duplicates in the database.
    *   If it's a new image, it extracts the data using the Gemini AI model.
    *   Performs post-analysis processing (e.g., calculating cell voltage differences).
    *   Fetches weather data if applicable.
    *   Saves the complete analysis record to the database.
4.  **Response:** The `analyze` function returns the full `AnalysisRecord` to the frontend.
5.  **Display:** The frontend receives the complete record and displays the results immediately, without the need for polling.

### Multiple-File Asynchronous Flow

1.  **Upload:** The user uploads multiple image files.
2.  **Request:** The frontend sends a request to the `/api/analyze` endpoint with all the image data.
3.  **Job Creation:** The `analyze` function on the backend:
    *   Checks for duplicates.
    *   For each new image, it creates a job document in the `jobs` collection in the database.
    *   It then asynchronously invokes the `process-analysis` function for each job.
4.  **Job IDs:** The `analyze` function returns a list of job IDs to the frontend.
5.  **Polling:** The frontend polls the `/api/get-job-status` endpoint with the job IDs to get the status of each analysis. The polling interval is dynamic and uses a `setTimeout` loop to prevent overlapping requests, which helps to avoid rate-limiting issues.
6.  **Processing:** The `process-analysis` function (running in the background) performs the same analysis steps as the synchronous flow for each job.
7.  **Completion:** Once a job is complete, the polling mechanism on the frontend will detect this, fetch the final `AnalysisRecord`, and display the results.

# Building and Running

**Prerequisites:**

*   Node.js (version 20, as specified in `package.json`)
*   A Gemini API key

**Instructions:**

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Set up environment variables:**
    Create a `.env.local` file in the root of the project and add your Gemini API key:
    ```
    GEMINI_API_KEY=your_gemini_api_key
    ```

3.  **Run the development server:**
    ```bash
    npm run dev
    ```
    This will start the Vite development server and make the application available at `http://localhost:5173`.

**Other Scripts:**

*   **Build for production:**
    ```bash
    npm run build
    ```
*   **Preview the production build:**
    ```bash
    npm run preview
    ```

# Development Conventions

*   **State Management:** The application uses React's `useReducer` and `useContext` hooks for state management, as seen in `state/appState.tsx` and `state/adminState.tsx`.
*   **Styling:** The application uses Tailwind CSS for styling.
*   **Linting and Formatting:** There are no explicit linting or formatting configurations in the `package.json` file. However, the code is well-formatted and consistent, suggesting that a linter or formatter is being used.
*   **Testing:** There are no explicit testing configurations in the `package.json` file. However, there are a few test files in the root directory (`test-createTimer.js`, `test-fixes.js`), which suggests that some form of testing is being done.

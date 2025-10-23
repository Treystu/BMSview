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

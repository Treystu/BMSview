# AI Feedback System API Documentation

This document provides instructions for using the AI Feedback System API.

## Endpoints

### POST /api/feedback

This endpoint receives feedback from the user.

**Request Body:**

```json
{
  "suggestionId": "string",
  "vote": "up" | "down"
}
```

**Response:**

```json
{
  "status": "success"
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // DATABASE HEALTH CHECK
    if (url.pathname === "/api/health") {
      try {
        const result = await env.DB
          .prepare("SELECT COUNT(*) AS count FROM clients")
          .first();

        return Response.json({
          ok: true,
          database: "connected",
          clients: result?.count ?? 0
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            database: "error",
            message: error.message
          },
          { status: 500 }
        );
      }
    }

    // PRIVATE REQUEST FORM
    if (url.pathname === "/api/request" && request.method === "POST") {
      try {
        const data = await request.json();

        const firstName = String(data.first_name || "").trim();
        const lastName = String(data.last_name || "").trim();
        const email = String(data.email || "").trim().toLowerCase();
        const phone = String(data.phone || "").trim();

        const requestedDate = String(data.requested_date || "").trim();
        const requestedTime = String(data.requested_time || "").trim();

        // Required fields
        if (
          !firstName ||
          !lastName ||
          !email ||
          !phone ||
          !requestedDate ||
          !requestedTime
        ) {
          return Response.json(
            {
              ok: false,
              message: "Please complete all required fields."
            },
            { status: 400 }
          );
        }

        // Basic email validation
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email)) {
          return Response.json(
            {
              ok: false,
              message: "Please enter a valid email address."
            },
            { status: 400 }
          );
        }

        // Check blacklist before accepting request
        const blacklisted = await env.DB
          .prepare(`
            SELECT id
            FROM blacklist
            WHERE LOWER(email) = LOWER(?)
               OR phone = ?
            LIMIT 1
          `)
          .bind(email, phone)
          .first();

        if (blacklisted) {
          return Response.json(
            {
              ok: false,
              message: "This request cannot be submitted."
            },
            { status: 403 }
          );
        }

        // Create client record
        const clientResult = await env.DB
          .prepare(`
            INSERT INTO clients (
              first_name,
              last_name,
              email,
              phone,
              status
            )
            VALUES (?, ?, ?, ?, 'active')
          `)
          .bind(
            firstName,
            lastName,
            email,
            phone
          )
          .run();

        const clientId = clientResult.meta.last_row_id;

        // Create date request
        await env.DB
          .prepare(`
            INSERT INTO date_requests (
              client_id,
              requested_date,
              requested_time,
              status,
              deposit_paid,
              id_received,
              final_approval,
              notes
            )
            VALUES (?, ?, ?, 'pending', 0, 0, 0, ?)
          `)
          .bind(
            clientId,
            requestedDate,
            requestedTime,
            String(data.notes || "").trim()
          )
          .run();

        return Response.json({
          ok: true,
          message:
            "Thank you. Your private request has been received for review."
        });

      } catch (error) {
        console.error("Request submission error:", error);

        return Response.json(
          {
            ok: false,
            message:
              "Your request could not be submitted. Please try again."
          },
          { status: 500 }
        );
      }
    }

    // Reject unsupported methods to the request API
    if (url.pathname === "/api/request") {
      return Response.json(
        {
          ok: false,
          message: "Method not allowed."
        },
        {
          status: 405,
          headers: {
            Allow: "POST"
          }
        }
      );
    }

    // SERVE THE EXISTING WEBSITE
    return env.ASSETS.fetch(request);
  }
};

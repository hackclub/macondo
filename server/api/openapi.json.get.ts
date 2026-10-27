export default defineEventHandler((event) => {
  const url = getRequestURL(event);

  setResponseHeader(event, "content-type", "application/json; charset=utf-8");

  return {
    openapi: "3.1.0",
    info: {
      title: "Macondo Public API",
      version: "1.0.0",
      description:
        "Read-only public endpoints for projects, profiles, shop items, and shop suggestions. Some responses include extra viewer-specific fields when called with a signed-in session cookie.",
    },
    servers: [{ url: `${url.protocol}//${url.host}` }],
    tags: [
      { name: "Health" },
      { name: "Shop" },
      { name: "Profiles" },
      { name: "Projects" },
      { name: "Events" },
      { name: "Invite Codes" },
      { name: "App" },
    ],
    paths: {
      "/api/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          operationId: "getHealth",
          responses: {
            "200": {
              description: "Service is alive",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
          },
        },
      },
      "/api/shop/requests": {
        get: {
          tags: ["Shop"],
          summary: "List public shop suggestions",
          operationId: "getShopSuggestions",
          parameters: [
            {
              name: "sort",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["top", "new"], default: "top" },
            },
            {
              name: "page",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, default: 1 },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 50, default: 50 },
            },
            {
              name: "q",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Case-insensitive search across name, description, and group tag.",
            },
          ],
          responses: {
            "200": {
              description: "Open shop suggestions",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ShopSuggestionsResponse" },
                },
              },
            },
          },
        },
      },
      "/api/shop/requests/matches": {
        get: {
          tags: ["Shop"],
          summary: "Find similar shop suggestions",
          operationId: "getShopSuggestionMatches",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 3 },
              description: "Suggestion name to compare against existing open suggestions.",
            },
          ],
          responses: {
            "200": {
              description: "Best matching open suggestions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["items"],
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ShopSuggestionMatch" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/music/enabled": {
        get: {
          tags: ["App"],
          summary: "Read the global music enabled flag",
          operationId: "getMusicEnabled",
          responses: {
            "200": {
              description: "Whether site music is currently enabled",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["enabled"],
                    properties: {
                      enabled: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/users/{username}": {
        get: {
          tags: ["Profiles"],
          summary: "Fetch a public user profile",
          operationId: "getPublicUserProfile",
          parameters: [
            {
              name: "username",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Public username, case-insensitive. User ID also works.",
            },
          ],
          responses: {
            "200": {
              description: "Public profile and shipped-project-style project cards",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicUserProfile" },
                },
              },
            },
            "404": {
              description: "User not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}": {
        get: {
          tags: ["Projects"],
          summary: "Fetch a public project",
          operationId: "getProject",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "lang",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["en", "es"] },
              description: "Optional translation locale for journals and feedback.",
            },
          ],
          responses: {
            "200": {
              description: "Project detail payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicProject" },
                },
              },
            },
            "404": {
              description: "Project not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}/collaborators": {
        get: {
          tags: ["Projects"],
          summary: "List project collaborators",
          operationId: "getProjectCollaborators",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "integer", minimum: 1 },
            },
          ],
          responses: {
            "200": {
              description: "Active roster for public viewers; owner sees full historical roster when authenticated as owner.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProjectCollaboratorsResponse" },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}/ships": {
        get: {
          tags: ["Projects"],
          summary: "List public ship history for a project",
          operationId: "getProjectShips",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "lang",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["en", "es"] },
              description: "Optional translation locale for reviewer feedback.",
            },
          ],
          responses: {
            "200": {
              description: "Ship history",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ProjectShip" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}/journals": {
        get: {
          tags: ["Projects"],
          summary: "List public journals for a project",
          operationId: "getProjectJournals",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "lang",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["en", "es"] },
              description: "Optional translation locale for journal content.",
            },
          ],
          responses: {
            "200": {
              description: "Project journals",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ProjectJournal" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/events/{id}": {
        get: {
          tags: ["Events"],
          summary: "Fetch a published public event",
          operationId: "getEvent",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "integer", minimum: 1 },
            },
          ],
          responses: {
            "200": {
              description: "Published event plus the caller's RSVP status when signed in.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicEvent" },
                },
              },
            },
            "404": {
              description: "Event not found or not published",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/invite-codes/{code}/preview": {
        get: {
          tags: ["Invite Codes"],
          summary: "Preview a project invite code",
          operationId: "previewInviteCode",
          parameters: [
            {
              name: "code",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Project invite code.",
            },
          ],
          responses: {
            "200": {
              description: "Minimal descriptor for the project that owns the invite code.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InviteCodePreview" },
                },
              },
            },
            "400": {
              description: "Invalid invite code format",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "404": {
              description: "Invite code not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "429": {
              description: "Rate limited",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        HealthResponse: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["ok"] },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            statusCode: { type: "integer" },
            statusMessage: { type: "string" },
            message: { type: "string" },
          },
          additionalProperties: true,
        },
        ShopSuggestion: {
          type: "object",
          required: [
            "id",
            "name",
            "upvote_count",
            "downvote_count",
            "show_username",
            "voted",
            "downvoted",
            "can_delete",
          ],
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            description: { type: ["string", "null"] },
            store_url: { type: ["string", "null"] },
            image_url: { type: ["string", "null"] },
            cluster_id: { type: ["integer", "null"] },
            group_tag: { type: ["string", "null"] },
            upvote_count: { type: "integer" },
            downvote_count: { type: "integer" },
            show_username: { type: "boolean" },
            created_at: { type: ["string", "null"], format: "date-time" },
            submitter: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  properties: {
                    username: { type: ["string", "null"] },
                    image: { type: ["string", "null"] },
                  },
                  additionalProperties: false,
                },
              ],
            },
            vote: { anyOf: [{ type: "string", enum: ["up", "down"] }, { type: "null" }] },
            voted: { type: "boolean" },
            downvoted: { type: "boolean" },
            can_delete: { type: "boolean" },
          },
        },
        ShopSuggestionMatch: {
          type: "object",
          required: ["id", "name", "upvote_count"],
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            description: { type: ["string", "null"] },
            group_tag: { type: ["string", "null"] },
            upvote_count: { type: "integer" },
          },
        },
        ShopSuggestionsResponse: {
          type: "object",
          required: ["items", "total", "page", "limit", "viewer_signed_in", "viewer_verified"],
          properties: {
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/ShopSuggestion" },
            },
            total: { type: "integer" },
            page: { type: "integer" },
            limit: { type: "integer" },
            viewer_signed_in: { type: "boolean" },
            viewer_verified: { type: "boolean" },
          },
        },
        PublicUserProfile: {
          type: "object",
          required: ["id", "project_count", "total_upvotes", "top_streak_days", "projects"],
          properties: {
            id: { type: "string" },
            username: { type: ["string", "null"] },
            image: { type: ["string", "null"] },
            slack_id: { type: ["string", "null"] },
            created_at: { type: ["string", "null"], format: "date-time" },
            last_active_date: { type: ["string", "null"] },
            project_count: { type: "integer" },
            total_upvotes: { type: "integer" },
            top_streak_days: { type: "integer" },
            projects: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicProjectCard" },
            },
          },
        },
        PublicProjectCard: {
          type: "object",
          required: ["id", "name", "type", "upvote_count", "current_user_upvoted", "has_shipped", "owner"],
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            description: { type: ["string", "null"] },
            type: { type: "string", enum: ["software", "hardware"] },
            fruit: { type: ["string", "null"] },
            level: { type: ["string", "null"] },
            thumbnail_url: { type: ["string", "null"] },
            project_streak_days: { type: "integer" },
            last_worked_date: { type: ["string", "null"] },
            created_at: { type: ["string", "null"], format: "date-time" },
            updated_at: { type: ["string", "null"], format: "date-time" },
            upvote_count: { type: "integer" },
            current_user_upvoted: { type: "boolean" },
            has_shipped: { type: "boolean" },
            owner: {
              type: "object",
              properties: {
                id: { type: "string" },
                image: { type: ["string", "null"] },
                username: { type: ["string", "null"] },
                slack_id: { type: ["string", "null"] },
                created_at: { type: ["string", "null"], format: "date-time" },
              },
              additionalProperties: false,
            },
          },
        },
        PublicProjectOwner: {
          type: "object",
          properties: {
            id: { type: "string" },
            image: { type: ["string", "null"] },
            username: { type: ["string", "null"] },
            slack_id: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
        PublicProject: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            description: { type: ["string", "null"] },
            type: { type: ["string", "null"] },
            level: { type: ["string", "null"] },
            fruit: { type: ["string", "null"] },
            thumbnail_url: { type: ["string", "null"] },
            owner: { $ref: "#/components/schemas/PublicProjectOwner" },
            viewer_is_owner: { type: "boolean" },
            viewer_can_edit: { type: "boolean" },
            journals: {
              type: "array",
              items: { $ref: "#/components/schemas/ProjectJournal" },
            },
            activeShip: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  properties: {
                    id: { type: "integer" },
                    status: { type: "string" },
                    created_at: { type: ["string", "null"], format: "date-time" },
                  },
                  additionalProperties: true,
                },
              ],
            },
            needsChangesShip: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  properties: {
                    id: { type: "integer" },
                    status: { type: "string" },
                    decision_user_message: { type: ["string", "null"] },
                    reviewed_at: { type: ["string", "null"], format: "date-time" },
                  },
                  additionalProperties: true,
                },
              ],
            },
            is_extra_fruity: { type: "boolean" },
          },
          additionalProperties: true,
        },
        ProjectCollaborator: {
          type: "object",
          properties: {
            id: { type: ["integer", "null"] },
            user_id: { type: "string" },
            status: { type: "string" },
            joined_at: { type: ["string", "null"], format: "date-time" },
            left_at: { type: ["string", "null"], format: "date-time" },
            joined_via: { type: ["string", "null"] },
            username: { type: ["string", "null"] },
            slack_id: { type: ["string", "null"] },
            image: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
        ProjectCollaboratorsResponse: {
          type: "object",
          required: ["owner_id", "is_owner", "max_collaborators", "collaborators"],
          properties: {
            owner_id: { type: "string" },
            is_owner: { type: "boolean" },
            max_collaborators: { type: "integer" },
            collaborators: {
              type: "array",
              items: { $ref: "#/components/schemas/ProjectCollaborator" },
            },
          },
        },
        ProjectShip: {
          type: "object",
          properties: {
            id: { type: "integer" },
            status: { type: "string" },
            hackatime_hours: { type: ["number", "null"] },
            override_hours: { type: ["number", "null"] },
            created_at: { type: ["string", "null"], format: "date-time" },
            reviewed_at: { type: ["string", "null"], format: "date-time" },
            fruitRewarded: { type: ["number", "null"] },
            decision_user_message: { type: ["string", "null"] },
            is_fraud_rejection: { type: "boolean" },
          },
          additionalProperties: true,
        },
        ProjectJournal: {
          type: "object",
          properties: {
            id: { type: "integer" },
            short_brief: { type: ["string", "null"] },
            long_brief: { type: ["string", "null"] },
            content_language: { type: ["string", "null"] },
            translated_from: { type: ["string", "null"] },
            created_at: { type: ["string", "null"], format: "date-time" },
            archived: { type: ["boolean", "null"] },
          },
          additionalProperties: true,
        },
        PublicEvent: {
          type: "object",
          required: ["id", "title", "status", "rsvp_status"],
          properties: {
            id: { type: "integer" },
            title: { type: "string" },
            description: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            image_url: { type: ["string", "null"] },
            starts_at: { type: ["string", "null"], format: "date-time" },
            ends_at: { type: ["string", "null"], format: "date-time" },
            timezone: { type: ["string", "null"] },
            status: { type: "string" },
            rsvp_status: { type: ["string", "null"] },
          },
        },
        InviteCodePreview: {
          type: "object",
          required: ["project_id", "project_name", "project_type", "owner"],
          properties: {
            project_id: { type: "integer" },
            project_name: { type: "string" },
            project_description: { type: ["string", "null"] },
            project_thumbnail: { type: ["string", "null"] },
            project_type: { type: ["string", "null"] },
            owner: {
              type: "object",
              required: ["id"],
              properties: {
                id: { type: "string" },
                username: { type: ["string", "null"] },
                slack_id: { type: ["string", "null"] },
              },
              additionalProperties: false,
            },
          },
        },
      },
    },
  };
});

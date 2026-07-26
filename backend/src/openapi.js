const jsonResponse = (description, schema = { type: "object" }) => ({
  description,
  content: { "application/json": { schema } }
});

const errorResponses = {
  "400": jsonResponse("Validation error", { $ref: "#/components/schemas/Error" }),
  "401": jsonResponse("Authentication required", { $ref: "#/components/schemas/Error" }),
  "404": jsonResponse("Resource not found", { $ref: "#/components/schemas/Error" }),
  "409": jsonResponse("Revision or idempotency conflict", { $ref: "#/components/schemas/Error" })
};

const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  schema: { type: "string", maxLength: 200 },
  description: "Required for writes when API_REQUIRE_IDEMPOTENCY=true."
};

const tripId = {
  name: "tripId",
  in: "path",
  required: true,
  schema: { type: "string" }
};

const agentRunId = {
  name: "runId",
  in: "path",
  required: true,
  schema: { type: "string" }
};

const ifMatchHeader = {
  name: "If-Match",
  in: "header",
  required: false,
  schema: { type: "string" },
  description: "Quoted current trip revision id. May replace body.baseRevisionId."
};

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "路线故事 API",
    version: "0.2.0",
    description:
      "北京旅行路线的持久化、版本、执行记录与合作方适配契约。后端 provider 默认均为明确标记的 Mock。"
  },
  servers: [{ url: "/api/v1" }],
  tags: [
    { name: "system" },
    { name: "content" },
    { name: "trips" },
    { name: "agent" },
    { name: "execution" },
    { name: "providers" }
  ],
  paths: {
    "/health": {
      get: {
        tags: ["system"],
        summary: "兼容健康检查",
        security: [],
        responses: { "200": jsonResponse("Service status") }
      }
    },
    "/livez": {
      get: {
        tags: ["system"],
        summary: "进程存活探针",
        security: [],
        responses: { "200": jsonResponse("Alive") }
      }
    },
    "/readyz": {
      get: {
        tags: ["system"],
        summary: "数据库与服务就绪探针",
        security: [],
        responses: {
          "200": jsonResponse("Ready"),
          "503": jsonResponse("Not ready", { $ref: "#/components/schemas/Error" })
        }
      }
    },
    "/imports": {
      get: {
        tags: ["content"],
        summary: "列出当前用户的来源交接",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" }
        ],
        responses: { "200": jsonResponse("Import page"), ...errorResponses }
      }
    },
    "/imports/xiaohongshu": {
      post: {
        tags: ["content"],
        summary: "接收用户主动提供的小红书分享链接",
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["shareUrl", "handoffMode"],
                properties: {
                  shareUrl: { type: "string", format: "uri" },
                  shareText: {
                    type: "string",
                    maxLength: 12000,
                    description: "用户主动提供的分享文案；服务端不会保存正文全文。"
                  },
                  handoffMode: { const: "USER_INITIATED" }
                }
              }
            }
          }
        },
        responses: {
          "201": jsonResponse("Import created", {
            $ref: "#/components/schemas/XiaohongshuImport"
          }),
          ...errorResponses
        }
      }
    },
    "/imports/{importId}": {
      get: {
        tags: ["content"],
        summary: "读取当前用户的来源交接",
        parameters: [{
          name: "importId",
          in: "path",
          required: true,
          schema: { type: "string" }
        }],
        responses: { "200": jsonResponse("Import"), ...errorResponses }
      }
    },
    "/trips": {
      get: {
        tags: ["trips"],
        summary: "列出当前用户的行程",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" },
          {
            name: "status",
            in: "query",
            schema: { enum: ["DRAFT", "CONFIRMED", "READY"] }
          }
        ],
        responses: { "200": jsonResponse("Trip page"), ...errorResponses }
      },
      post: {
        tags: ["trips"],
        summary: "创建行程与 revision 1",
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateTripRequest" }
            }
          }
        },
        responses: { "201": jsonResponse("Trip created"), ...errorResponses }
      }
    },
    "/trips/{tripId}": {
      get: {
        tags: ["trips"],
        summary: "读取当前行程快照",
        parameters: [tripId],
        responses: {
          "200": jsonResponse("Trip", { $ref: "#/components/schemas/Trip" }),
          ...errorResponses
        }
      }
    },
    "/trips/{tripId}/schedule": {
      put: {
        tags: ["trips"],
        summary: "基于 revision 原子保存排程",
        parameters: [
          tripId,
          idempotencyHeader,
          ifMatchHeader
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["stops"],
                properties: {
                  baseRevisionId: { type: "string" },
                  status: { const: "CONFIRMED" },
                  plannerState: { $ref: "#/components/schemas/PlannerState" },
                  stops: {
                    type: "array",
                    minItems: 1,
                    maxItems: 20,
                    items: { $ref: "#/components/schemas/TripStop" }
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": jsonResponse("New trip revision", { $ref: "#/components/schemas/Trip" }),
          ...errorResponses
        }
      }
    },
    "/trips/{tripId}/revisions": {
      get: {
        tags: ["trips"],
        summary: "列出 revision 历史",
        parameters: [
          tripId,
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" }
        ],
        responses: { "200": jsonResponse("Revision page"), ...errorResponses }
      }
    },
    "/trips/{tripId}/revisions/{revisionId}": {
      get: {
        tags: ["trips"],
        summary: "读取历史 revision 快照",
        parameters: [
          tripId,
          {
            name: "revisionId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "200": jsonResponse("Historical trip", { $ref: "#/components/schemas/Trip" }),
          ...errorResponses
        }
      }
    },
    "/trips/{tripId}/agent-runs": {
      get: {
        tags: ["trips"],
        summary: "列出 Agent Run",
        parameters: [
          tripId,
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" }
        ],
        responses: { "200": jsonResponse("Agent run page"), ...errorResponses }
      },
      post: {
        tags: ["agent"],
        summary: "排队执行可暂停、可恢复、可撤回的模型 Agent Run",
        parameters: [tripId, idempotencyHeader, ifMatchHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["instruction"],
                properties: {
                  baseRevisionId: { type: "string" },
                  instruction: { type: "string", minLength: 1, maxLength: 2000 }
                }
              }
            }
          }
        },
        responses: {
          "202": jsonResponse("Agent run queued", {
            $ref: "#/components/schemas/AgentRun"
          }),
          "503": jsonResponse("Agent provider unavailable", {
            $ref: "#/components/schemas/Error"
          }),
          ...errorResponses
        }
      }
    },
    "/trips/{tripId}/agent-runs/{runId}": {
      get: {
        tags: ["agent"],
        summary: "Read one durable Agent run",
        parameters: [tripId, agentRunId],
        responses: {
          "200": jsonResponse("Agent run", { $ref: "#/components/schemas/AgentRun" }),
          ...errorResponses
        }
      }
    },
    "/trips/{tripId}/agent-runs/{runId}/events": {
      get: {
        tags: ["agent"],
        summary: "Read ordered Agent events after a cursor",
        parameters: [
          tripId,
          agentRunId,
          {
            name: "after",
            in: "query",
            schema: { type: "integer", minimum: 0, default: 0 }
          },
          { $ref: "#/components/parameters/Limit" }
        ],
        responses: {
          "200": jsonResponse("Agent event cursor page", {
            $ref: "#/components/schemas/AgentEventPage"
          }),
          ...errorResponses
        }
      }
    },
    "/trips/{tripId}/agent-runs/{runId}/commands": {
      post: {
        tags: ["agent"],
        summary: "Request pause, resume, or stop at a tool boundary",
        parameters: [tripId, agentRunId, idempotencyHeader, ifMatchHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["command"],
                properties: {
                  command: {
                    enum: ["PAUSE", "RESUME", "STOP", "pause", "resume", "stop"]
                  },
                  baseRevisionId: {
                    type: "string",
                    description: "Required on RESUME when manual edits changed the trip revision."
                  }
                }
              }
            }
          }
        },
        responses: {
          "202": jsonResponse("Command persisted", {
            $ref: "#/components/schemas/AgentRun"
          }),
          ...errorResponses
        }
      }
    },
    "/trips/{tripId}/agent-runs/{runId}/undo": {
      post: {
        tags: ["agent"],
        summary: "Append a revision that restores the Agent base snapshot",
        parameters: [
          tripId,
          agentRunId,
          idempotencyHeader,
          { ...ifMatchHeader, required: true }
        ],
        responses: {
          "200": jsonResponse("Agent undo applied"),
          ...errorResponses
        }
      }
    },
    "/trips/{tripId}/execution-events": {
      get: {
        tags: ["execution"],
        summary: "读取实际出行事件",
        parameters: [
          tripId,
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" }
        ],
        responses: { "200": jsonResponse("Execution event page"), ...errorResponses }
      },
      post: {
        tags: ["execution"],
        summary: "追加实际出行事件",
        parameters: [tripId, idempotencyHeader],
        responses: { "201": jsonResponse("Execution event"), ...errorResponses }
      }
    },
    "/trips/{tripId}/booking-options": {
      get: {
        tags: ["providers"],
        summary: "读取预订合作接入位",
        parameters: [tripId],
        responses: {
          "200": jsonResponse("Booking options", {
            $ref: "#/components/schemas/BookingOptions"
          }),
          ...errorResponses
        }
      }
    },
    "/trips/{tripId}/booking-options/{bookingOptionId}/redirects": {
      post: {
        tags: ["providers"],
        summary: "创建可审计的合作跳转",
        parameters: [
          tripId,
          idempotencyHeader,
          {
            name: "bookingOptionId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "201": jsonResponse("Redirect", {
            $ref: "#/components/schemas/BookingIntentReceipt"
          }),
          ...errorResponses
        }
      }
    },
    "/providers/baidu/places/search": {
      get: {
        tags: ["providers"],
        summary: "通过地图 provider adapter 搜索地点",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          { name: "city", in: "query", schema: { type: "string", default: "北京" } }
        ],
        responses: { "200": jsonResponse("Place results"), ...errorResponses }
      }
    },
    "/providers/baidu/routes": {
      get: {
        tags: ["providers"],
        summary: "通过地图 provider adapter 计算路线",
        responses: { "200": jsonResponse("Route result"), ...errorResponses }
      }
    }
  },
  components: {
    securitySchemes: {
      serviceBearer: { type: "http", scheme: "bearer" },
      trustedUser: { type: "apiKey", in: "header", name: "X-User-Id" }
    },
    parameters: {
      Limit: {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 500, default: 20 }
      },
      Offset: {
        name: "offset",
        in: "query",
        schema: { type: "integer", minimum: 0, default: 0 }
      }
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: { type: "array", items: {} }
            }
          }
        }
      },
      ProviderRef: {
        type: "object",
        required: ["provider", "providerPlaceId"],
        properties: {
          provider: { type: "string" },
          providerPlaceId: { type: "string" }
        }
      },
      XiaohongshuImport: {
        type: "object",
        required: ["importId", "status", "source", "extraction", "warnings"],
        properties: {
          importId: { type: "string" },
          status: { const: "READY_FOR_REVIEW" },
          source: {
            type: "object",
            required: ["platform", "sourceUrl", "metadataStatus"],
            properties: {
              platform: { const: "XIAOHONGSHU" },
              sourceUrl: { type: "string", format: "uri" },
              resolvedUrl: { type: ["string", "null"], format: "uri" },
              metadataStatus: { enum: ["PUBLIC_METADATA", "FALLBACK"] },
              fallbackCode: { type: ["string", "null"] },
              authorName: { type: "string" }
            }
          },
          extraction: {
            type: "object",
            required: ["mode", "title", "city", "stops"],
            properties: {
              mode: {
                enum: [
                  "PUBLIC_METADATA_WITH_DEMO_ROUTE",
                  "DEMO_ROUTE_FALLBACK"
                ]
              },
              title: { type: "string" },
              city: { type: "string" },
              summary: { type: "string" },
              stops: { type: "array", items: { type: "object" } }
            }
          },
          warnings: { type: "array", items: { type: "string" } }
        }
      },
      BookingOption: {
        type: "object",
        required: [
          "bookingOptionId",
          "clientStopId",
          "placeName",
          "address",
          "productType",
          "availabilityStatus"
        ],
        properties: {
          bookingOptionId: { type: "string" },
          tripRevisionId: { type: "string" },
          clientStopId: { type: "string" },
          internalPlaceId: { type: ["string", "null"] },
          placeName: { type: "string" },
          address: { type: "string" },
          productType: { enum: ["DINING", "ACTIVITY"] },
          availabilityStatus: { const: "SIMULATED" },
          price: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
          disclosure: { type: "string" }
        }
      },
      BookingOptions: {
        type: "object",
        required: ["tripId", "provider", "options", "warnings"],
        properties: {
          tripId: { type: "string" },
          provider: { type: "object" },
          options: {
            type: "array",
            items: { $ref: "#/components/schemas/BookingOption" }
          },
          warnings: { type: "array", items: { type: "string" } }
        }
      },
      BookingIntentReceipt: {
        type: "object",
        required: [
          "redirectId",
          "tripId",
          "bookingOptionId",
          "status",
          "receiptStatus",
          "createdAt"
        ],
        properties: {
          redirectId: { type: "string" },
          tripId: { type: "string" },
          bookingOptionId: { type: "string" },
          status: { const: "MOCK_PLACEHOLDER" },
          receiptStatus: { const: "MOCK_RECORDED" },
          createdAt: { type: "string", format: "date-time" },
          redirectUrl: { type: ["string", "null"], format: "uri" },
          option: { $ref: "#/components/schemas/BookingOption" }
        }
      },
      PlannerState: {
        type: "object",
        additionalProperties: false,
        required: ["constraints", "transportModeOverrides"],
        properties: {
          constraints: {
            type: "array",
            maxItems: 50,
            items: { type: "object" }
          },
          transportModeOverrides: {
            type: "object",
            maxProperties: 100,
            additionalProperties: { type: "string", maxLength: 32 }
          }
        }
      },
      TripStop: {
        type: "object",
        required: ["clientStopId", "name", "scheduledTime", "durationMinutes"],
        properties: {
          clientStopId: { type: "string" },
          sourceStopId: { type: ["string", "null"] },
          placeId: { type: ["string", "null"] },
          providerRefs: {
            type: "array",
            items: { $ref: "#/components/schemas/ProviderRef" }
          },
          name: { type: "string" },
          scheduledTime: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" },
          durationMinutes: { type: "integer", minimum: 15, maximum: 720 },
          note: { type: "string" },
          address: { type: "string" },
          latitude: { type: ["number", "null"] },
          longitude: { type: ["number", "null"] },
          coordSystem: {
            type: ["string", "null"],
            enum: ["WGS84", "GCJ02", "BD09", "BD09LL", null]
          },
          imageUrl: { type: ["string", "null"] },
          category: { type: ["string", "null"] },
          locked: { type: "boolean" }
        }
      },
      CreateTripRequest: {
        type: "object",
        properties: {
          title: { type: "string" },
          city: { type: "string" },
          timezone: { type: "string", default: "Asia/Shanghai" },
          status: { enum: ["DRAFT", "CONFIRMED", "READY"] },
          sourceImportId: { type: ["string", "null"] },
          sourceRouteId: { type: ["string", "null"] },
          source: { type: "object" },
          plannerState: { $ref: "#/components/schemas/PlannerState" },
          stops: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: { $ref: "#/components/schemas/TripStop" }
          }
        }
      },
      AgentOperation: {
        type: "object",
        required: [
          "operationId",
          "sequence",
          "toolName",
          "type",
          "status",
          "baseRevisionId"
        ],
        properties: {
          operationId: { type: "string" },
          sequence: { type: "integer", minimum: 1 },
          providerCallId: { type: "string" },
          toolName: {
            enum: ["move_stop", "set_stop_lock", "remove_stop", "finish_replan"]
          },
          type: { type: "string" },
          status: { enum: ["PENDING", "RUNNING", "APPLIED", "REJECTED", "FAILED"] },
          targetClientStopId: { type: ["string", "null"] },
          before: { type: ["object", "null"] },
          after: { type: ["object", "null"] },
          reason: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          baseRevisionId: { type: "string" },
          resultRevisionId: { type: ["string", "null"] },
          arguments: { type: "object" },
          output: {},
          error: {}
        }
      },
      AgentRun: {
        type: "object",
        required: [
          "runId",
          "tripId",
          "baseRevisionId",
          "currentRevisionId",
          "status",
          "instruction",
          "provider",
          "runVersion",
          "operations",
          "createdAt",
          "updatedAt"
        ],
        properties: {
          runId: { type: "string" },
          tripId: { type: "string" },
          baseRevisionId: { type: "string" },
          currentRevisionId: { type: "string" },
          resultRevisionId: { type: ["string", "null"] },
          status: {
            enum: [
              "QUEUED", "PLANNING", "RUNNING", "PAUSE_REQUESTED", "PAUSED",
              "RESUMING", "STOP_REQUESTED", "STOPPED", "COMPLETED", "FAILED",
              "CONFLICTED", "UNDOING", "UNDONE"
            ]
          },
          instruction: { type: "string" },
          provider: { type: "string" },
          model: { type: ["string", "null"] },
          summary: { type: ["string", "null"] },
          error: { type: ["object", "null"] },
          runVersion: { type: "integer", minimum: 1 },
          operations: {
            type: "array",
            items: { $ref: "#/components/schemas/AgentOperation" }
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          startedAt: { type: ["string", "null"], format: "date-time" },
          completedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      AgentEvent: {
        type: "object",
        required: ["eventId", "runId", "sequence", "type", "payload", "createdAt"],
        properties: {
          eventId: { type: "string" },
          runId: { type: "string" },
          sequence: { type: "integer", minimum: 1 },
          type: { type: "string" },
          payload: { type: "object" },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      AgentEventPage: {
        type: "object",
        required: ["runId", "run", "events", "nextCursor", "hasMore", "terminal"],
        properties: {
          runId: { type: "string" },
          run: { $ref: "#/components/schemas/AgentRun" },
          events: {
            type: "array",
            items: { $ref: "#/components/schemas/AgentEvent" }
          },
          nextCursor: { type: "integer", minimum: 0 },
          hasMore: { type: "boolean" },
          terminal: { type: "boolean" }
        }
      },
      Trip: {
        allOf: [
          { $ref: "#/components/schemas/CreateTripRequest" },
          {
            type: "object",
            required: ["tripId", "revisionId", "revision", "stops"],
            properties: {
              tripId: { type: "string" },
              revisionId: { type: "string" },
              revision: { type: "integer" },
              currentRevisionId: { type: "string" },
              isCurrentRevision: { type: "boolean" }
            }
          }
        ]
      }
    }
  },
  security: [{ serviceBearer: [], trustedUser: [] }]
};

export const TRIP_PREFERENCE_JSON_SCHEMA = {
  $id: 'TripPreference',
  type: 'object',
  additionalProperties: false,
  required: [
    'tripTitle',
    'startDate',
    'endDate',
    'totalDays',
    'totalBudgetKrw',
    'partySize',
    'companions',
    'pace',
    'baseCamp',
    'mobilityConstraint',
    'userPriorities',
    'rainFallbackPolicy',
    'area',
    'startTime',
    'endTime',
    'budget',
    'interests',
    'preferences',
    'avoid',
    'maxWalkMinutes',
    'anchorPlace',
    'days',
  ],
  properties: {
    tripTitle: { type: ['string', 'null'], maxLength: 200 },
    startDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    endDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    totalDays: { type: ['integer', 'null'], minimum: 1, maximum: 30 },
    totalBudgetKrw: {
      type: ['integer', 'null'],
      minimum: 0,
      maximum: 100_000_000,
    },
    partySize: { type: ['integer', 'null'], minimum: 1, maximum: 50 },
    companions: {
      type: ['string', 'null'],
      enum: ['solo', 'couple', 'friends', 'family', 'other', null],
    },
    pace: {
      type: ['string', 'null'],
      enum: ['relaxed', 'balanced', 'packed', null],
    },
    airport: { type: ['string', 'null'], maxLength: 200 },
    baseCamp: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['name', 'checkInTime', 'checkOutTime', 'dailyReturnTime'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        checkInTime: {
          type: ['string', 'null'],
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
        },
        checkOutTime: {
          type: ['string', 'null'],
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
        },
        dailyReturnTime: {
          type: ['string', 'null'],
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
        },
      },
    },
    mobilityConstraint: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['maxWalkMinutesPerLeg', 'avoidSteepInclineOrStairs', 'preferredTransit'],
      properties: {
        maxWalkMinutesPerLeg: { type: 'integer', minimum: 1, maximum: 60 },
        avoidSteepInclineOrStairs: { type: 'boolean' },
        preferredTransit: {
          type: ['string', 'null'],
          enum: ['subway', 'bus', 'walk', 'taxi', null],
        },
      },
    },
    userPriorities: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'string',
        enum: ['crowd_avoidance', 'must_visit', 'short_transit', 'interest', 'budget'],
      },
    },
    rainFallbackPolicy: {
      type: ['string', 'null'],
      enum: ['indoor_switch', 'keep', null],
    },
    // Single-day shortcut fields (backward compatible)
    area: { type: ['string', 'null'], minLength: 1, maxLength: 120 },
    startTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
    endTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
    budget: { type: ['integer', 'null'], minimum: 0, maximum: 10_000_000 },
    interests: {
      type: 'array',
      maxItems: 20,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    preferences: {
      type: 'array',
      maxItems: 20,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    avoid: {
      type: 'array',
      maxItems: 20,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    maxWalkMinutes: {
      type: ['integer', 'null'],
      minimum: 1,
      maximum: 60,
    },
    anchorPlace: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['name', 'targetTime', 'role'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        targetTime: {
          type: ['string', 'null'],
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
        },
        role: {
          type: ['string', 'null'],
          enum: ['start', 'intermediate', 'destination', null],
        },
      },
    },
    // Hierarchical multi-day array
    days: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'dayNumber',
          'date',
          'title',
          'area',
          'startTime',
          'endTime',
          'dailyBudgetKrw',
          'startAnchor',
          'endAnchor',
          'fixedAppointments',
          'mealWindows',
          'mustVisitPlaces',
          'interests',
          'preferences',
          'avoid',
          'maxWalkMinutes',
          'anchorPlace',
        ],
        properties: {
          dayNumber: { type: 'integer', minimum: 1, maximum: 30 },
          date: {
            type: ['string', 'null'],
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          },
          title: { type: ['string', 'null'], maxLength: 200 },
          area: { type: ['string', 'null'], minLength: 1, maxLength: 120 },
          startTime: {
            type: 'string',
            pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
          },
          endTime: {
            type: 'string',
            pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
          },
          dailyBudgetKrw: {
            type: ['integer', 'null'],
            minimum: 0,
            maximum: 10_000_000,
          },
          startAnchor: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['name', 'targetTime', 'role'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 200 },
              targetTime: {
                type: ['string', 'null'],
                pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
              },
              role: {
                type: ['string', 'null'],
                enum: ['start', 'intermediate', 'destination', null],
              },
            },
          },
          endAnchor: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['name', 'targetTime', 'role'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 200 },
              targetTime: {
                type: ['string', 'null'],
                pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
              },
              role: {
                type: ['string', 'null'],
                enum: ['start', 'intermediate', 'destination', null],
              },
            },
          },
          fixedAppointments: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'targetTime', 'durationMinutes', 'isMandatory', 'category'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 200 },
                targetTime: {
                  type: 'string',
                  pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
                },
                durationMinutes: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 600,
                },
                isMandatory: { type: 'boolean' },
                category: { type: ['string', 'null'], maxLength: 80 },
              },
            },
          },
          mealWindows: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['mealType', 'targetTime', 'durationMinutes', 'cuisinePreferences', 'area'],
              properties: {
                mealType: { type: 'string', enum: ['lunch', 'dinner'] },
                targetTime: {
                  type: 'string',
                  pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
                },
                durationMinutes: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 300,
                },
                cuisinePreferences: {
                  type: 'array',
                  items: { type: 'string', minLength: 1, maxLength: 80 },
                },
                area: {
                  type: ['string', 'null'],
                  minLength: 1,
                  maxLength: 120,
                },
              },
            },
          },
          mustVisitPlaces: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          interests: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
          preferences: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
          avoid: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
          maxWalkMinutes: {
            type: ['integer', 'null'],
            minimum: 1,
            maximum: 60,
          },
          anchorPlace: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['name', 'targetTime', 'role'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 200 },
              targetTime: {
                type: ['string', 'null'],
                pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
              },
              role: {
                type: ['string', 'null'],
                enum: ['start', 'intermediate', 'destination', null],
              },
            },
          },
        },
      },
    },
  },
} as const;

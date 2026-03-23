import { z } from "zod";

// Raw API response schemas for runtime validation

export const resourceLocationSchema = z.object({
  resourceLocationId: z.number(),
  resourceLocationLocalizedValues: z.object({
    en: z.string(),
    fr: z.string().optional(),
  }),
  mapId: z.number(),
  regionId: z.number(),
  description: z.string().default(""),
  hasAlerts: z.boolean().default(false),
  resourceCategoryIds: z.array(z.number()).default([]),
  parkAlerts: z.array(z.object({
    alertId: z.number(),
    alertTitle: z.string(),
    alertDescription: z.string(),
  })).default([]),
});

export const campgroundMapSchema = z.object({
  mapId: z.number(),
  localizedValues: z.object({
    en: z.string(),
    fr: z.string().optional(),
  }).optional(),
  mapLinks: z.array(z.object({
    mapLinkId: z.number(),
    parentMapId: z.number(),
    childMapId: z.number(),
    title: z.string().default(""),
    localizedValues: z.object({
      en: z.string(),
      fr: z.string().optional(),
    }).optional(),
  })).default([]),
});

export const resourceAvailabilitySchema = z.object({
  resourceId: z.number(),
  availability: z.number(),
  bookingCategoryId: z.number().optional(),
  mapId: z.number().optional(),
});

export const mapLinkAvailabilitySchema = z.object({
  mapLinkId: z.number(),
  availability: z.number(),
  childMapId: z.number().optional(),
});

export const availabilityResponseSchema = z.object({
  resourceAvailabilities: z.record(z.string(), resourceAvailabilitySchema).default({}),
  mapLinkAvailabilities: z.record(z.string(), mapLinkAvailabilitySchema).default({}),
});

export const equipmentCategorySchema = z.object({
  equipmentCategoryId: z.number(),
  localizedValues: z.object({
    en: z.string(),
    fr: z.string().optional(),
  }),
  subEquipmentCategories: z.array(z.object({
    subEquipmentCategoryId: z.number(),
    localizedValues: z.object({
      en: z.string(),
      fr: z.string().optional(),
    }),
  })).default([]),
});

export type RawResourceLocation = z.infer<typeof resourceLocationSchema>;
export type RawCampgroundMap = z.infer<typeof campgroundMapSchema>;
export type RawAvailabilityResponse = z.infer<typeof availabilityResponseSchema>;
export type RawEquipmentCategory = z.infer<typeof equipmentCategorySchema>;

import { z } from "zod";

// Raw API response schemas for runtime validation

export const resourceLocationSchema = z.object({
  resourceLocationId: z.number(),
  rootMapId: z.number(),
  localizedValues: z.array(z.object({
    cultureName: z.string(),
    shortName: z.string(),
    fullName: z.string(),
  })),
  resourceCategoryIds: z.array(z.number()).default([]),
});

export const campgroundMapSchema = z.object({
  mapId: z.number(),
  localizedValues: z.array(z.object({
    cultureName: z.string(),
    title: z.string(),
  })).default([]),
  mapLinks: z.array(z.object({
    resourceLocationId: z.number(),
    transactionLocationId: z.number(),
    childMapId: z.number().optional(),
    localizations: z.array(z.object({
      cultureName: z.string(),
      title: z.string(),
    })).default([]),
  })).default([]),
});

export const resourceAvailabilitySchema = z.object({
  availability: z.number(),
  remainingQuota: z.number().nullable(),
});

export const mapLinkAvailabilitySchema = z.object({
  mapLinkId: z.number(),
  availability: z.number(),
  childMapId: z.number().optional(),
});

export const availabilityResponseSchema = z.object({
  mapId: z.number(),
  mapAvailabilities: z.array(z.number()),
  resourceAvailabilities: z.record(z.string(), z.array(resourceAvailabilitySchema)),
  mapLinkAvailabilities: z.record(z.string(), z.any()).default({}),
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

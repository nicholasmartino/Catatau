export interface EquipmentCategory {
  equipmentCategoryId: number;
  localizedValues: { en: string; fr?: string };
  subEquipmentCategories: SubEquipmentCategory[];
}

export interface SubEquipmentCategory {
  subEquipmentCategoryId: number;
  localizedValues: { en: string; fr?: string };
}

export interface Equipment {
  name: string;
  categoryId: number;
  subCategoryId?: number;
}

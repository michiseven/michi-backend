export interface AccessibilityLegEvidence {
  status: 'checked' | 'unavailable';
  method: 'seoul-gis-straight-corridor-v1' | 'unavailable';
  risk: 'none-detected' | 'steep' | 'stairs' | 'steep-and-stairs' | 'unknown';
  derivedGradePercent: number | null;
  explicitMaxSlopePercent: number | null;
  stairFeatureCount: number;
  steepFeatureCount: number;
  sourceRefs: string[];
  disclaimer: string;
}

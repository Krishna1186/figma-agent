import { z } from 'zod';

// Define the colors as a union or string (simplified for now)
const ColorSchema = z.string().describe("Hex color code, e.g., #FF0000");

// Action: Create Element
export const CreateElementSchema = z.object({
    action: z.literal('CREATE_ELEMENT'),
    type: z.enum(['RECTANGLE', 'Frame', 'TEXT']), // 'Frame' and 'TEXT' to match Figma types loosely
    properties: z.object({
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        fill: ColorSchema.optional(),
        text: z.string().optional(), // Only for TEXT type
    }),
});

// Action: Modify Selection
export const ModifySelectionSchema = z.object({
    action: z.literal('MODIFY_SELECTION'),
    properties: z.object({
        fill: ColorSchema.optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        opacity: z.number().min(0).max(1).optional(),
    }),
});

// Union of all possible actions
export const AgentActionSchema = z.union([CreateElementSchema, ModifySelectionSchema]);

export type AgentAction = z.infer<typeof AgentActionSchema>;

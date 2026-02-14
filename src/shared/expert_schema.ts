import { z } from 'zod';

// --- Basic Types ---
const Color = z.string().describe("Hex color #RRGGBB or #RRGGBBAA");

const RGB = z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() });

const GradientStop = z.object({
    position: z.number().min(0).max(1),
    color: Color
});

const Paint = z.union([
    z.object({ type: z.literal('SOLID'), color: Color, opacity: z.number().optional() }),
    z.object({
        type: z.union([z.literal('GRADIENT_LINEAR'), z.literal('GRADIENT_RADIAL')]),
        stops: z.array(GradientStop),
        transform: z.array(z.array(z.number())).optional() // Affine transform matrix
    }),
    z.object({ type: z.literal('IMAGE'), imageHash: z.string().optional(), scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional() })
]);

const Effect = z.object({
    type: z.enum(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR']),
    color: Color.optional(),
    offset: z.object({ x: z.number(), y: z.number() }).optional(),
    radius: z.number(),
    spread: z.number().optional(),
    visible: z.boolean().optional()
});

const LayoutProps = z.object({
    layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL']).optional(),
    primaryAxisAlignItems: z.enum(['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN']).optional(),
    counterAxisAlignItems: z.enum(['MIN', 'MAX', 'CENTER', 'BASELINE']).optional(),
    itemSpacing: z.number().optional(),
    paddingTop: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingBottom: z.number().optional(),
    paddingLeft: z.number().optional(),
    width: z.union([z.literal('HUG'), z.literal('FILL'), z.number()]).optional(),
    height: z.union([z.literal('HUG'), z.literal('FILL'), z.number()]).optional(),
});

const StrokeProps = z.object({
    strokes: z.array(Paint).optional(),
    strokeWeight: z.number().optional(),
    strokeAlign: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional(),
    dashPattern: z.array(z.number()).optional(),
    cornerRadius: z.union([
        z.number(),
        z.object({ topLeft: z.number(), topRight: z.number(), bottomLeft: z.number(), bottomRight: z.number() })
    ]).optional()
});

// --- Node Types ---

const BaseNode = z.object({
    name: z.string().optional(),
    visible: z.boolean().optional(),
    opacity: z.number().optional(),
    blendMode: z.enum(['PASS_THROUGH', 'NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'DARKEN', 'LIGHTEN', 'COLOR_DODGE', 'COLOR_BURN', 'HARD_LIGHT', 'SOFT_LIGHT', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY']).optional(),
    effects: z.array(Effect).optional(),
});

// Recursive definition for children
export const FigmaNodeSchema: z.ZodType<any> = z.lazy(() =>
    z.discriminatedUnion('type', [
        z.object({
            type: z.literal('FRAME'),
            children: z.array(FigmaNodeSchema).optional(),
            fills: z.array(Paint).optional(),
            clipsContent: z.boolean().optional(),
            ...LayoutProps.shape,
            ...StrokeProps.shape,
            ...BaseNode.shape
        }),
        z.object({
            type: z.literal('RECTANGLE'),
            width: z.number(),
            height: z.number(),
            fills: z.array(Paint).optional(),
            ...StrokeProps.shape,
            ...BaseNode.shape
        }),
        z.object({
            type: z.literal('TEXT'),
            characters: z.string(),
            fontSize: z.number().optional(),
            fontName: z.object({ family: z.string(), style: z.string() }).optional(),
            textAlignHorizontal: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional(),
            textAlignVertical: z.enum(['TOP', 'CENTER', 'BOTTOM']).optional(),
            textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).optional(),
            letterSpacing: z.number().optional(),
            lineHeight: z.union([z.number(), z.object({ value: z.number(), unit: z.enum(['PIXELS', 'PERCENT']) })]).optional(),
            fills: z.array(Paint).optional(),
            ...BaseNode.shape
        }),
        z.object({
            type: z.literal('IMAGE_NODE'), // Custom type wrapper to inject uploaded image
            width: z.number(),
            height: z.number(),
            imageData: z.string().optional(), // Base64 or reference ID from upload
            ...StrokeProps.shape,
            ...BaseNode.shape
        })
    ])
);

export type FigmaNode = z.infer<typeof FigmaNodeSchema>;

// Action Wrapper
export const AgentActionSchema = z.union([
    z.object({
        action: z.literal('CREATE_TREE'),
        root: FigmaNodeSchema
    }),
    z.object({
        action: z.literal('UPDATE_SELECTION'),
        properties: z.record(z.any()) // Relaxed for update
    })
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;

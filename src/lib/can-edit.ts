import type {
    DriverCommandIssuer,
    ProtocolCommandError,
} from "@drawdy/driver-protocol";

type Ctx = {
    issueCommand: DriverCommandIssuer;
    driverId: string;
    nextRequestId: () => string;
};

type Answer = { res?: { error?: unknown; value?: { canEdit?: unknown } } };

/**
 * Whether this person may change the board right now. The protocol this repo
 * builds against predates `command:auth:check-can-edit` (protocol 1.5.0), and
 * hosts without it refuse the command while letting every write through, so
 * anything short of a clear `canEdit: false` means they can edit.
 */
export async function canEdit(ctx: Ctx): Promise<boolean> {
    try {
        const answer = (await ctx.issueCommand({
            type: "command:auth:check-can-edit",
            driverId: ctx.driverId,
            requestId: ctx.nextRequestId(),
        } as unknown as Parameters<DriverCommandIssuer>[0])) as Answer;
        return (
            answer?.res?.error !== undefined ||
            answer?.res?.value?.canEdit !== false
        );
    } catch {
        return true;
    }
}

/** A board write the host refused because this person may only view the board. */
export const isReadOnlyRefusal = (error: ProtocolCommandError): boolean =>
    error.type === "unauthorized" && error.body?.reason === "read-only";

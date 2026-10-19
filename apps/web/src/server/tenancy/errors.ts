/** A business-rule violation that is safe to show to the user (no internal details). */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "invalid"
      | "conflict"
      | "last_owner"
      | "forbidden"
      | "invitation_invalid" = "invalid",
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function notFoundInTenant(entity: string): DomainError {
  // Deliberately identical for "does not exist" and "belongs to another organization".
  return new DomainError(`${entity} not found`, "not_found");
}

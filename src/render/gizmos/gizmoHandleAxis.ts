// Small shared flag: the TransformControls handle currently under the pointer
// (null when none). Entity body dragging checks it so a gizmo handle drag and a
// body drag can never start from the same pointerdown.
export const gizmoHandleAxis: { axis: string | null } = { axis: null };

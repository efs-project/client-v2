// A save the SDK held back (ALREADY_ATTEMPTED, sdk-v2 31ee83a): the same publication is already
// on its way. The review then says which case it is, from the saves listed (shell/save-hold.ts
// `twinStanding`): the same save again ("already being saved", no second Send), or another save
// of the same bytes (Send again once that one is final). This call sent nothing, and its twin may
// land or have landed: never "nothing was saved".

import type { EfsWriter } from '@efs/sdk/actions';
import type { SavingHost } from '../../shell/apps.ts';
import { twinFromReconcile } from '../../shell/save-hold.ts';
import type { Twin } from '../../shell/save-outcome.ts';
import type { CheckResult } from '../../shell/saves-state.ts';

/**
 * Reads the twin again, so the saves list shows it: by its save when the SDK named one (the
 * saves session settles listed saves from the ledger), else by its attempt first.
 */
export async function settleTwin(
  saving: SavingHost,
  writer: EfsWriter,
  twin: Twin | undefined,
): Promise<CheckResult> {
  if (twin && twin.sequenceId === undefined) {
    await writer.reconcile(twin.planId).catch((error: unknown) => {
      console.warn('could not settle the earlier attempt', twin.planId, error);
    });
  }
  return saving.refresh();
}

/**
 * A twin the saves don't list, checked by its attempt: 'settled' once it's final or proven not
 * committed, else 'waiting' (a failed check waits too).
 */
export async function checkTwin(writer: EfsWriter, twin: Twin): Promise<'settled' | 'waiting'> {
  try {
    return twinFromReconcile(await writer.reconcile(twin.planId));
  } catch (error) {
    console.warn('could not check the earlier attempt', twin.planId, error);
    return 'waiting';
  }
}

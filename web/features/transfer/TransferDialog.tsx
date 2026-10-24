import { useQueryClient } from '@tanstack/react-query'
import { Button, Dialog } from '@wefaber/ui'
import { Download, LoaderCircle, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useUi } from '../../app/ui'
import { t } from '../../i18n'
import { useToast } from '../../lib/toast'
import { downloadExport, uploadImport } from './transfer'

const message = (e: unknown) =>
  e instanceof Error && e.message ? e.message : t('error.generic')

/** Exportar e importar la org (ADR 0008): un JSON con todo, que se vuelve a leer sin pérdida. */
export function TransferDialog({ orgId }: { orgId: string | null }) {
  const { transferOpen, setTransfer } = useUi()
  return (
    <Dialog
      open={transferOpen && orgId !== null}
      onClose={() => setTransfer(false)}
      title={t('transfer.title')}
      closeLabel={t('toast.dismiss')}
    >
      {orgId ? <TransferBody orgId={orgId} /> : null}
    </Dialog>
  )
}

function TransferBody({ orgId }: { orgId: string }) {
  const show = useToast((s) => s.show)
  const client = useQueryClient()
  const [withFiles, setWithFiles] = useState(true)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [picked, setPicked] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const doExport = async () => {
    setBusy('export')
    setError(null)
    try {
      await downloadExport(orgId, { attachments: withFiles })
      show({ kind: 'info', text: t('transfer.exported') })
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  const doImport = async () => {
    if (!picked) return
    setBusy('import')
    setError(null)
    try {
      const r = await uploadImport(orgId, picked)
      // El servidor avisa por SSE, pero el diálogo no espera: se pide de nuevo lo que hay en pantalla.
      await client.invalidateQueries()
      setPicked(null)
      if (input.current) input.current.value = ''
      show({
        kind: 'info',
        text: t('transfer.imported', { lists: r.lists, items: r.items }),
      })
      if (r.skippedAttachments > 0 || r.unmatchedRefs > 0)
        setError(
          t('transfer.partial', {
            files: r.skippedAttachments,
            refs: r.unmatchedRefs,
          }),
        )
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="tx-export" className="flex flex-col gap-2">
        <h3 id="tx-export" className="text-body font-semibold">
          {t('transfer.exportTitle')}
        </h3>
        <p className="text-meta text-muted">{t('transfer.exportHelp')}</p>
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            checked={withFiles}
            onChange={(e) => setWithFiles(e.target.checked)}
          />
          {t('transfer.withFiles')}
        </label>
        <div>
          <Button variant="primary" onClick={doExport} disabled={busy !== null}>
            {busy === 'export' ? (
              <LoaderCircle aria-hidden size={14} />
            ) : (
              <Download aria-hidden size={14} />
            )}
            {t('transfer.export')}
          </Button>
        </div>
      </section>

      <section aria-labelledby="tx-import" className="flex flex-col gap-2">
        <h3 id="tx-import" className="text-body font-semibold">
          {t('transfer.importTitle')}
        </h3>
        <p className="text-meta text-muted">{t('transfer.importHelp')}</p>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          aria-label={t('transfer.pick')}
          className="text-body"
          onChange={(e) => {
            setPicked(e.target.files?.[0] ?? null)
            setError(null)
          }}
        />
        <div>
          <Button
            variant="primary"
            onClick={doImport}
            disabled={busy !== null || !picked}
          >
            {busy === 'import' ? (
              <LoaderCircle aria-hidden size={14} />
            ) : (
              <Upload aria-hidden size={14} />
            )}
            {t('transfer.import')}
          </Button>
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

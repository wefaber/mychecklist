import { Button, IconButton } from '@wefaber/ui'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { t } from '../i18n'
import { useToast } from '../lib/toast'

/**
 * Aviso de abajo: confirma una acción (con "Deshacer" si se puede) o explica un fallo. La región `aria-live` está
 * siempre montada para que los lectores de pantalla anuncien el texto cuando aparece.
 */
export function Toaster() {
  const { toast, dismiss } = useToast()
  const Icon = toast?.kind === 'error' ? CircleAlert : CircleCheck
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {toast ? (
        <div
          key={toast.id}
          className="pointer-events-auto flex max-w-xl animate-pop-in items-center gap-3 rounded-panel border border-border bg-surface-2 py-2 pr-2 pl-4 text-body text-text shadow-float"
        >
          <Icon
            aria-hidden
            size={16}
            className={toast.kind === 'error' ? 'text-danger' : 'text-success'}
          />
          <span className="min-w-0">{toast.text}</span>
          {toast.action ? (
            <Button
              variant="secondary"
              onClick={() => {
                toast.action!.run()
                dismiss()
              }}
            >
              {toast.action.label}
            </Button>
          ) : null}
          <IconButton
            label={t('toast.dismiss')}
            icon={<X size={16} />}
            onClick={dismiss}
          />
        </div>
      ) : null}
    </div>
  )
}

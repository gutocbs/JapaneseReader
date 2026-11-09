import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import type { DocumentTag } from '../../shared/api/client';
import { tagColorForName } from '../documents/tags';

interface ReaderTagsPopupProps {
  tags: DocumentTag[];
  loadCatalog: () => Promise<DocumentTag[]>;
  onSaveTags: (tags: DocumentTag[]) => Promise<void>;
  onCreateTag: (tag: DocumentTag) => Promise<DocumentTag>;
}

function hasTag(tags: DocumentTag[], name: string) {
  return tags.some((tag) => tag.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
}

export function ReaderTagsPopup({
  tags,
  loadCatalog,
  onSaveTags,
  onCreateTag,
}: ReaderTagsPopupProps) {
  const titleId = useId();
  const popupId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [catalog, setCatalog] = useState<DocumentTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    let current = true;
    setError('');
    void loadCatalog()
      .then((loaded) => { if (current) setCatalog(loaded); })
      .catch(() => { if (current) setError('Não foi possível carregar as etiquetas disponíveis.'); });
    const onPointerDown = (event: PointerEvent) => {
      if (popupRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      current = false;
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen, loadCatalog]);

  const save = async (nextTags: DocumentTag[]) => {
    setIsSaving(true);
    setError('');
    try {
      await onSaveTags(nextTags);
    } catch {
      setError('Não foi possível salvar as etiquetas deste documento.');
    } finally {
      setIsSaving(false);
    }
  };

  const create = async () => {
    const name = newTagName.trim();
    if (!name || hasTag(tags, name)) return;
    setIsSaving(true);
    setError('');
    try {
      const created = await onCreateTag({ name, color: tagColorForName(name) });
      await onSaveTags([...tags, created]);
      setCatalog((current) => hasTag(current, created.name) ? current : [...current, created]);
      setNewTagName('');
    } catch {
      setError('Não foi possível criar e associar a etiqueta.');
    } finally {
      setIsSaving(false);
    }
  };

  const availableTags = catalog.filter((tag) => !hasTag(tags, tag.name));

  return (
    <div className="reader-tags-popup" ref={popupRef}>
      <button
        ref={triggerRef}
        className={`reader-rail__button reader-rail__tags${isOpen ? ' reader-rail__tags--active' : ''}`}
        type="button"
        aria-label="Etiquetas do documento"
        aria-haspopup="dialog"
        aria-controls={isOpen ? popupId : undefined}
        aria-expanded={isOpen}
        title="Etiquetas do documento"
        onClick={() => isOpen ? close() : setIsOpen(true)}
        onKeyDown={(event) => {
          if (!isOpen || event.key !== 'Escape') return;
          event.preventDefault();
          close();
        }}
      >
        <span aria-hidden="true">#</span>
      </button>
      {isOpen && (
        <section
          className="reader-tags-popup__panel"
          id={popupId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            close();
          }}
        >
          <div className="reader-tags-popup__heading">
            <div>
              <p className="eyebrow">Organização</p>
              <h2 id={titleId}>Etiquetas do documento</h2>
            </div>
          </div>
          <div className="reader-tags-popup__current-tags">
            <ul className="metadata-tags" aria-label="Etiquetas atuais">
              {tags.map((tag) => (
                <li key={tag.name}>
                  <span className="metadata-tag" aria-label={`Etiqueta ${tag.name}`} style={{ '--tag-color': tag.color } as CSSProperties}>{tag.name}</span>
                  <button className="tag-remove-button" type="button" disabled={isSaving} aria-label={`Remover etiqueta ${tag.name}`} title={`Remover etiqueta ${tag.name}`} onClick={() => void save(tags.filter((item) => item.name !== tag.name))}>
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {tags.length === 0 && <p className="reader-tags-popup__empty">Nenhuma etiqueta neste documento.</p>}
          {availableTags.length > 0 && (
            <div className="tag-selection" aria-label="Etiquetas disponíveis">
              <div className="tag-selection__options">
                {availableTags.map((tag) => (
                  <button key={tag.name} className="tag-selection__option" type="button" disabled={isSaving} aria-label={`Selecionar etiqueta ${tag.name}`} onClick={() => void save([...tags, tag])}>
                    <span className="metadata-tag" style={{ '--tag-color': tag.color } as CSSProperties}>{tag.name}</span>
                    <span aria-hidden="true">+</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="metadata-tag-form reader-tags-popup__creation">
            <label>
              <span className="sr-only">Nova etiqueta</span>
              <input aria-label="Nova etiqueta" value={newTagName} disabled={isSaving} onChange={(event) => setNewTagName(event.target.value)} />
            </label>
            <button className="button button--secondary" type="button" disabled={isSaving || newTagName.trim().length === 0 || hasTag(tags, newTagName.trim())} onClick={() => void create()}>
              Criar e adicionar
            </button>
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}

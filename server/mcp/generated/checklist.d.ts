// Generado por scripts/gen-codemode.ts desde server/services/registry.ts. No se edita a mano.

interface List {
  id: string
  name: string
  /** Items sin completar. */
  open: number
  /** Items vivos. */
  total: number
}

/** Un item enlazado con `[[id]]`. */
interface Mention {
  id: string
  listId: string
  listName: string
  title: string
  done: boolean
}

interface Item {
  id: string
  listId: string
  parentId: string | null
  /** Markdown. */
  text: string
  done: boolean
  doneAt: string | null
  /** Fecha ISO 8601. */
  createdAt: string
  /** Fecha ISO 8601. */
  updatedAt: string
  mentions: Mention[]
}

interface SearchHit {
  id: string
  listId: string
  listName: string
  text: string
  done: boolean
}

interface Activity {
  id: string
  type: string
  entityType: string | null
  entityId: string | null
  /** web, mcp, import o job. */
  via: string
  /** Fecha ISO 8601. */
  at: string
}

/** La organización del token. */
interface Org {
  id: string
  name: string
  kind: "personal" | "team"
  role: "owner" | "admin" | "member"
}

declare const checklist: {
  org: {
    /** La organización del token y el rol del usuario en ella. [read] */
    get(): Promise<Org>
  }
  lists: {
    /** Las listas vivas, en orden. [read] */
    list(): Promise<List[]>
    /** Una lista por id. [read] */
    get(input: {
      id: string
    }): Promise<List>
    /** Crea una lista. `afterId`: el item o la lista tras la que va; omitido va al final y `null` al principio. [write] */
    create(input: {
      name: string
      afterId?: string | null
    }): Promise<List>
    /** Cambia el nombre de una lista. [write] */
    rename(input: {
      id: string
      name: string
    }): Promise<List>
    /** Mueve una lista. `afterId`: el item o la lista tras la que va; omitido va al final y `null` al principio. [write] */
    move(input: {
      id: string
      afterId?: string | null
    }): Promise<List>
    /** Borra una lista (borrado lógico: `lists.restore` la devuelve). [write] */
    delete(input: {
      id: string
    }): Promise<List>
    /** Restaura una lista borrada. [write] */
    restore(input: {
      id: string
    }): Promise<List>
  }
  items: {
    /** Items vivos de una lista, planos y en orden (los subitems traen `parentId`). Hasta 500 por llamada; seguí con `offset`. [read] */
    list(input: {
      listId: string
      limit?: number
      offset?: number
    }): Promise<Item[]>
    /** Un item vivo por id, o null si no existe. [read] */
    get(input: {
      id: string
    }): Promise<Item | null>
    /** Busca items por texto en toda la organización (hasta 50). [read] */
    search(input: {
      query: string
      first?: number
    }): Promise<SearchHit[]>
    /** Items vivos cuyo texto enlaza a este con `[[id]]`. [read] */
    backlinks(input: {
      id: string
    }): Promise<Mention[]>
    /** Crea un item en una lista (con `parentId`, un subitem). `afterId`: el item o la lista tras la que va; omitido va al final y `null` al principio. [write] */
    create(input: {
      listId: string
      /** Markdown. */
      text: string
      parentId?: string | null
      afterId?: string | null
    }): Promise<Item>
    /** Reemplaza el texto (Markdown) de un item. [write] */
    updateText(input: {
      id: string
      text: string
    }): Promise<Item>
    /** Completa o reabre un item. [write] */
    setDone(input: {
      id: string
      done: boolean
    }): Promise<Item>
    /** Mueve un item (a otra lista o de padre con `listId` y `parentId`; omitidos, donde está; `parentId: null` lo pasa a primer nivel). `afterId`: el item o la lista tras la que va; omitido va al final y `null` al principio. [write] */
    move(input: {
      id: string
      afterId?: string | null
      listId?: string
      parentId?: string | null
    }): Promise<Item>
    /** Borra un item y sus subitems (borrado lógico: `items.restore` los devuelve). [write] */
    delete(input: {
      id: string
    }): Promise<Item>
    /** Restaura un item borrado. [write] */
    restore(input: {
      id: string
    }): Promise<Item>
  }
  activity: {
    /** Los últimos cambios de la organización, los más nuevos primero (hasta 100). [read] */
    list(input: {
      first?: number
    }): Promise<Activity[]>
  }
}

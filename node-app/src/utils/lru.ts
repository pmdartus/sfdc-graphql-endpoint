interface ListNode<K, V> {
    key: K;
    value: V;
    prev: ListNode<K, V> | null;
    next: ListNode<K, V> | null;
}

export class LRU<K, V> {
    limit: number;
    #map: Map<K, ListNode<K, V>> = new Map();
    #head: ListNode<K, V> | null = null;
    #tail: ListNode<K, V> | null = null;

    constructor(limit = 100) {
        this.limit = limit;
    }

    get(key: K): V | null {
        const entry = this.#map.get(key);

        if (entry === undefined) {
            return null;
        }

        if (entry !== this.#head) {
            this.set(key, entry.value);
        }

        return entry.value;
    }

    set(key: K, value: V): void {
        const existingEntry = this.#map.get(key);

        if (existingEntry !== undefined) {
            this.delete(key);
        } else if (this.#map.size >= this.limit && this.#tail !== null) {
            this.delete(this.#tail.key);
        }

        const newEntry = {
            key,
            value,
            prev: null,
            next: this.#head,
        };

        if (this.#head === null) {
            this.#head = this.#tail = newEntry;
        } else {
            this.#head.prev = newEntry;
            this.#head = newEntry;
        }

        this.#map.set(key, newEntry);
    }

    delete(key: K): void {
        const entry = this.#map.get(key);

        if (entry === undefined) {
            return;
        }

        this.#map.delete(key);

        if (entry.prev !== null) {
            entry.prev.next = entry.next;
        } else {
            this.#head = entry.next;
        }

        if (entry.next !== null) {
            entry.next.prev = entry.prev;
        } else {
            this.#tail = entry;
        }
    }

    clear() {
        this.#head = this.#tail = null;
        this.#map.clear();
    }

    *keys(): Generator<K> {
        const node = this.#head;

        while (node !== null) {
            yield node.key;
        }
    }

    *values(): Generator<V> {
        const node = this.#head;

        while (node !== null) {
            yield node.value;
        }
    }

    *entries(): Generator<[K, V]> {
        const node = this.#head;

        while (node !== null) {
            yield [node.key, node.value];
        }
    }
}

/******/ var __webpack_modules__ = ({

/***/ "./node_modules/idb/build/index.js":
/*!*****************************************!*\
  !*** ./node_modules/idb/build/index.js ***!
  \*****************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   deleteDB: () => (/* binding */ deleteDB),
/* harmony export */   openDB: () => (/* binding */ openDB),
/* harmony export */   unwrap: () => (/* binding */ unwrap),
/* harmony export */   wrap: () => (/* binding */ wrap)
/* harmony export */ });
const instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);

let idbProxyableTypes;
let cursorAdvanceMethods;
// This is a function to prevent it throwing up in node environments.
function getIdbProxyableTypes() {
    return (idbProxyableTypes ||
        (idbProxyableTypes = [
            IDBDatabase,
            IDBObjectStore,
            IDBIndex,
            IDBCursor,
            IDBTransaction,
        ]));
}
// This is a function to prevent it throwing up in node environments.
function getCursorAdvanceMethods() {
    return (cursorAdvanceMethods ||
        (cursorAdvanceMethods = [
            IDBCursor.prototype.advance,
            IDBCursor.prototype.continue,
            IDBCursor.prototype.continuePrimaryKey,
        ]));
}
const transactionDoneMap = new WeakMap();
const transformCache = new WeakMap();
const reverseTransformCache = new WeakMap();
function promisifyRequest(request) {
    const promise = new Promise((resolve, reject) => {
        const unlisten = () => {
            request.removeEventListener('success', success);
            request.removeEventListener('error', error);
        };
        const success = () => {
            resolve(wrap(request.result));
            unlisten();
        };
        const error = () => {
            reject(request.error);
            unlisten();
        };
        request.addEventListener('success', success);
        request.addEventListener('error', error);
    });
    // This mapping exists in reverseTransformCache but doesn't exist in transformCache. This
    // is because we create many promises from a single IDBRequest.
    reverseTransformCache.set(promise, request);
    return promise;
}
function cacheDonePromiseForTransaction(tx) {
    // Early bail if we've already created a done promise for this transaction.
    if (transactionDoneMap.has(tx))
        return;
    const done = new Promise((resolve, reject) => {
        const unlisten = () => {
            tx.removeEventListener('complete', complete);
            tx.removeEventListener('error', error);
            tx.removeEventListener('abort', error);
        };
        const complete = () => {
            resolve();
            unlisten();
        };
        const error = () => {
            reject(tx.error || new DOMException('AbortError', 'AbortError'));
            unlisten();
        };
        tx.addEventListener('complete', complete);
        tx.addEventListener('error', error);
        tx.addEventListener('abort', error);
    });
    // Cache it for later retrieval.
    transactionDoneMap.set(tx, done);
}
let idbProxyTraps = {
    get(target, prop, receiver) {
        if (target instanceof IDBTransaction) {
            // Special handling for transaction.done.
            if (prop === 'done')
                return transactionDoneMap.get(target);
            // Make tx.store return the only store in the transaction, or undefined if there are many.
            if (prop === 'store') {
                return receiver.objectStoreNames[1]
                    ? undefined
                    : receiver.objectStore(receiver.objectStoreNames[0]);
            }
        }
        // Else transform whatever we get back.
        return wrap(target[prop]);
    },
    set(target, prop, value) {
        target[prop] = value;
        return true;
    },
    has(target, prop) {
        if (target instanceof IDBTransaction &&
            (prop === 'done' || prop === 'store')) {
            return true;
        }
        return prop in target;
    },
};
function replaceTraps(callback) {
    idbProxyTraps = callback(idbProxyTraps);
}
function wrapFunction(func) {
    // Due to expected object equality (which is enforced by the caching in `wrap`), we
    // only create one new func per func.
    // Cursor methods are special, as the behaviour is a little more different to standard IDB. In
    // IDB, you advance the cursor and wait for a new 'success' on the IDBRequest that gave you the
    // cursor. It's kinda like a promise that can resolve with many values. That doesn't make sense
    // with real promises, so each advance methods returns a new promise for the cursor object, or
    // undefined if the end of the cursor has been reached.
    if (getCursorAdvanceMethods().includes(func)) {
        return function (...args) {
            // Calling the original function with the proxy as 'this' causes ILLEGAL INVOCATION, so we use
            // the original object.
            func.apply(unwrap(this), args);
            return wrap(this.request);
        };
    }
    return function (...args) {
        // Calling the original function with the proxy as 'this' causes ILLEGAL INVOCATION, so we use
        // the original object.
        return wrap(func.apply(unwrap(this), args));
    };
}
function transformCachableValue(value) {
    if (typeof value === 'function')
        return wrapFunction(value);
    // This doesn't return, it just creates a 'done' promise for the transaction,
    // which is later returned for transaction.done (see idbObjectHandler).
    if (value instanceof IDBTransaction)
        cacheDonePromiseForTransaction(value);
    if (instanceOfAny(value, getIdbProxyableTypes()))
        return new Proxy(value, idbProxyTraps);
    // Return the same value back if we're not going to transform it.
    return value;
}
function wrap(value) {
    // We sometimes generate multiple promises from a single IDBRequest (eg when cursoring), because
    // IDB is weird and a single IDBRequest can yield many responses, so these can't be cached.
    if (value instanceof IDBRequest)
        return promisifyRequest(value);
    // If we've already transformed this value before, reuse the transformed value.
    // This is faster, but it also provides object equality.
    if (transformCache.has(value))
        return transformCache.get(value);
    const newValue = transformCachableValue(value);
    // Not all types are transformed.
    // These may be primitive types, so they can't be WeakMap keys.
    if (newValue !== value) {
        transformCache.set(value, newValue);
        reverseTransformCache.set(newValue, value);
    }
    return newValue;
}
const unwrap = (value) => reverseTransformCache.get(value);

/**
 * Open a database.
 *
 * @param name Name of the database.
 * @param version Schema version.
 * @param callbacks Additional callbacks.
 */
function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
    const request = indexedDB.open(name, version);
    const openPromise = wrap(request);
    if (upgrade) {
        request.addEventListener('upgradeneeded', (event) => {
            upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
        });
    }
    if (blocked) {
        request.addEventListener('blocked', (event) => blocked(
        // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
        event.oldVersion, event.newVersion, event));
    }
    openPromise
        .then((db) => {
        if (terminated)
            db.addEventListener('close', () => terminated());
        if (blocking) {
            db.addEventListener('versionchange', (event) => blocking(event.oldVersion, event.newVersion, event));
        }
    })
        .catch(() => { });
    return openPromise;
}
/**
 * Delete a database.
 *
 * @param name Name of the database.
 */
function deleteDB(name, { blocked } = {}) {
    const request = indexedDB.deleteDatabase(name);
    if (blocked) {
        request.addEventListener('blocked', (event) => blocked(
        // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
        event.oldVersion, event));
    }
    return wrap(request).then(() => undefined);
}

const readMethods = ['get', 'getKey', 'getAll', 'getAllKeys', 'count'];
const writeMethods = ['put', 'add', 'delete', 'clear'];
const cachedMethods = new Map();
function getMethod(target, prop) {
    if (!(target instanceof IDBDatabase &&
        !(prop in target) &&
        typeof prop === 'string')) {
        return;
    }
    if (cachedMethods.get(prop))
        return cachedMethods.get(prop);
    const targetFuncName = prop.replace(/FromIndex$/, '');
    const useIndex = prop !== targetFuncName;
    const isWrite = writeMethods.includes(targetFuncName);
    if (
    // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
    !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) ||
        !(isWrite || readMethods.includes(targetFuncName))) {
        return;
    }
    const method = async function (storeName, ...args) {
        // isWrite ? 'readwrite' : undefined gzipps better, but fails in Edge :(
        const tx = this.transaction(storeName, isWrite ? 'readwrite' : 'readonly');
        let target = tx.store;
        if (useIndex)
            target = target.index(args.shift());
        // Must reject if op rejects.
        // If it's a write operation, must reject if tx.done rejects.
        // Must reject with op rejection first.
        // Must resolve with op value.
        // Must handle both promises (no unhandled rejections)
        return (await Promise.all([
            target[targetFuncName](...args),
            isWrite && tx.done,
        ]))[0];
    };
    cachedMethods.set(prop, method);
    return method;
}
replaceTraps((oldTraps) => ({
    ...oldTraps,
    get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
    has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop),
}));

const advanceMethodProps = ['continue', 'continuePrimaryKey', 'advance'];
const methodMap = {};
const advanceResults = new WeakMap();
const ittrProxiedCursorToOriginalProxy = new WeakMap();
const cursorIteratorTraps = {
    get(target, prop) {
        if (!advanceMethodProps.includes(prop))
            return target[prop];
        let cachedFunc = methodMap[prop];
        if (!cachedFunc) {
            cachedFunc = methodMap[prop] = function (...args) {
                advanceResults.set(this, ittrProxiedCursorToOriginalProxy.get(this)[prop](...args));
            };
        }
        return cachedFunc;
    },
};
async function* iterate(...args) {
    // tslint:disable-next-line:no-this-assignment
    let cursor = this;
    if (!(cursor instanceof IDBCursor)) {
        cursor = await cursor.openCursor(...args);
    }
    if (!cursor)
        return;
    cursor = cursor;
    const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
    ittrProxiedCursorToOriginalProxy.set(proxiedCursor, cursor);
    // Map this double-proxy back to the original, so other cursor methods work.
    reverseTransformCache.set(proxiedCursor, unwrap(cursor));
    while (cursor) {
        yield proxiedCursor;
        // If one of the advancing methods was not called, call continue().
        cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
        advanceResults.delete(proxiedCursor);
    }
}
function isIteratorProp(target, prop) {
    return ((prop === Symbol.asyncIterator &&
        instanceOfAny(target, [IDBIndex, IDBObjectStore, IDBCursor])) ||
        (prop === 'iterate' && instanceOfAny(target, [IDBIndex, IDBObjectStore])));
}
replaceTraps((oldTraps) => ({
    ...oldTraps,
    get(target, prop, receiver) {
        if (isIteratorProp(target, prop))
            return iterate;
        return oldTraps.get(target, prop, receiver);
    },
    has(target, prop) {
        return isIteratorProp(target, prop) || oldTraps.has(target, prop);
    },
}));




/***/ })

/******/ });
/************************************************************************/
/******/ // The module cache
/******/ var __webpack_module_cache__ = {};
/******/ 
/******/ // The require function
/******/ function __webpack_require__(moduleId) {
/******/ 	// Check if module is in cache
/******/ 	var cachedModule = __webpack_module_cache__[moduleId];
/******/ 	if (cachedModule !== undefined) {
/******/ 		return cachedModule.exports;
/******/ 	}
/******/ 	// Create a new module (and put it into the cache)
/******/ 	var module = __webpack_module_cache__[moduleId] = {
/******/ 		// no module.id needed
/******/ 		// no module.loaded needed
/******/ 		exports: {}
/******/ 	};
/******/ 
/******/ 	// Execute the module function
/******/ 	__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 
/******/ 	// Return the exports of the module
/******/ 	return module.exports;
/******/ }
/******/ 
/************************************************************************/
/******/ /* webpack/runtime/define property getters */
/******/ (() => {
/******/ 	// define getter functions for harmony exports
/******/ 	__webpack_require__.d = (exports, definition) => {
/******/ 		for(var key in definition) {
/******/ 			if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 				Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 			}
/******/ 		}
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/hasOwnProperty shorthand */
/******/ (() => {
/******/ 	__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ })();
/******/ 
/******/ /* webpack/runtime/make namespace object */
/******/ (() => {
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = (exports) => {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/ })();
/******/ 
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!************************************!*\
  !*** ./client/Blazor.IndexedDb.ts ***!
  \************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   IndexedDbManager: () => (/* binding */ IndexedDbManager),
/* harmony export */   add: () => (/* binding */ add),
/* harmony export */   batchAdd: () => (/* binding */ batchAdd),
/* harmony export */   batchDelete: () => (/* binding */ batchDelete),
/* harmony export */   batchPut: () => (/* binding */ batchPut),
/* harmony export */   clearIndexedDbObjectStore: () => (/* binding */ clearIndexedDbObjectStore),
/* harmony export */   clearStore: () => (/* binding */ clearStore),
/* harmony export */   closeDatabase: () => (/* binding */ closeDatabase),
/* harmony export */   count: () => (/* binding */ count),
/* harmony export */   countByKeyRange: () => (/* binding */ countByKeyRange),
/* harmony export */   countFromIndex: () => (/* binding */ countFromIndex),
/* harmony export */   countFromIndexByKeyRange: () => (/* binding */ countFromIndexByKeyRange),
/* harmony export */   createInstance: () => (/* binding */ createInstance),
/* harmony export */   deleteDatabase: () => (/* binding */ deleteDatabase),
/* harmony export */   deleteRecord: () => (/* binding */ deleteRecord),
/* harmony export */   get: () => (/* binding */ get),
/* harmony export */   getAll: () => (/* binding */ getAll),
/* harmony export */   getAllByArrayKey: () => (/* binding */ getAllByArrayKey),
/* harmony export */   getAllByKeyRange: () => (/* binding */ getAllByKeyRange),
/* harmony export */   getAllFromIndex: () => (/* binding */ getAllFromIndex),
/* harmony export */   getAllFromIndexByArrayKey: () => (/* binding */ getAllFromIndexByArrayKey),
/* harmony export */   getAllFromIndexByKeyRange: () => (/* binding */ getAllFromIndexByKeyRange),
/* harmony export */   getAllKeys: () => (/* binding */ getAllKeys),
/* harmony export */   getAllKeysByArrayKey: () => (/* binding */ getAllKeysByArrayKey),
/* harmony export */   getAllKeysByKeyRange: () => (/* binding */ getAllKeysByKeyRange),
/* harmony export */   getAllKeysFromIndex: () => (/* binding */ getAllKeysFromIndex),
/* harmony export */   getAllKeysFromIndexByArrayKey: () => (/* binding */ getAllKeysFromIndexByArrayKey),
/* harmony export */   getAllKeysFromIndexByKeyRange: () => (/* binding */ getAllKeysFromIndexByKeyRange),
/* harmony export */   getDbSchema: () => (/* binding */ getDbSchema),
/* harmony export */   getFromIndex: () => (/* binding */ getFromIndex),
/* harmony export */   getKey: () => (/* binding */ getKey),
/* harmony export */   getKeyFromIndex: () => (/* binding */ getKeyFromIndex),
/* harmony export */   openDatabase: () => (/* binding */ openDatabase),
/* harmony export */   put: () => (/* binding */ put),
/* harmony export */   query: () => (/* binding */ query),
/* harmony export */   queryFromIndex: () => (/* binding */ queryFromIndex)
/* harmony export */ });
/* harmony import */ var idb__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! idb */ "./node_modules/idb/build/index.js");

var instanceManager = {};
function createInstance(databaseName) {
    instanceManager[databaseName] = new IndexedDbManager();
}
function openDatabase(database) {
    ensureDatabaseInstance(database.name);
    return instanceManager[database.name].open(database);
}
function deleteDatabase(databaseName) {
    ensureDatabaseInstance(databaseName);
    instanceManager[databaseName].deleteDatabase();
}
function clearIndexedDbObjectStore(databaseName, storeName) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].clearObjectStore(storeName);
}
function closeDatabase(databaseName) {
    ensureDatabaseInstance(databaseName);
    instanceManager[databaseName].close();
}
function getDbSchema(databaseName) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getDbSchema();
}
function count(databaseName, storeName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].count(storeName, key);
}
function countByKeyRange(databaseName, storeName, lower, upper, lowerOpen, upperOpen) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].countByKeyRange(storeName, lower, upper, lowerOpen, upperOpen);
}
function get(databaseName, storeName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].get(storeName, key);
}
function getAll(databaseName, storeName, key, count) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAll(storeName, key, count);
}
function getAllByKeyRange(databaseName, storeName, lower, upper, lowerOpen, upperOpen, count) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllByKeyRange(storeName, lower, upper, lowerOpen, upperOpen, count);
}
function getAllByArrayKey(databaseName, storeName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllByArrayKey(storeName, key);
}
function getKey(databaseName, storeName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getKey(storeName, key);
}
function getAllKeys(databaseName, storeName, key, count) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllKeys(storeName, key, count);
}
function getAllKeysByKeyRange(databaseName, storeName, lower, upper, lowerOpen, upperOpen, count) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllKeysByKeyRange(storeName, lower, upper, lowerOpen, upperOpen, count);
}
function getAllKeysByArrayKey(databaseName, storeName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllKeysByArrayKey(storeName, key);
}
function query(databaseName, storeName, key, filter, count = 0, skip = 0) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].query(storeName, key, filter, count, skip);
}
function countFromIndex(databaseName, storeName, indexName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].countFromIndex(storeName, indexName, key);
}
function countFromIndexByKeyRange(databaseName, storeName, indexName, lower, upper, lowerOpen, upperOpen) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].countFromIndexByKeyRange(storeName, indexName, lower, upper, lowerOpen, upperOpen);
}
function getFromIndex(databaseName, storeName, indexName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getFromIndex(storeName, indexName, key);
}
function getAllFromIndex(databaseName, storeName, indexName, key, count) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllFromIndex(storeName, indexName, key, count);
}
function getAllFromIndexByKeyRange(databaseName, storeName, indexName, lower, upper, lowerOpen, upperOpen, count) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllFromIndexByKeyRange(storeName, indexName, lower, upper, lowerOpen, upperOpen, count);
}
function getAllFromIndexByArrayKey(databaseName, storeName, indexName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllFromIndexByArrayKey(storeName, indexName, key);
}
function getKeyFromIndex(databaseName, storeName, indexName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getKeyFromIndex(storeName, indexName, key);
}
function getAllKeysFromIndex(databaseName, storeName, indexName, key, count) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllKeysFromIndex(storeName, indexName, key, count);
}
function getAllKeysFromIndexByKeyRange(databaseName, storeName, indexName, lower, upper, lowerOpen, upperOpen, count) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllKeysFromIndexByKeyRange(storeName, indexName, lower, upper, lowerOpen, upperOpen, count);
}
function getAllKeysFromIndexByArrayKey(databaseName, storeName, indexName, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].getAllKeysFromIndexByArrayKey(storeName, indexName, key);
}
function queryFromIndex(databaseName, storeName, indexName, key, filter, count = 0, skip = 0) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].queryFromIndex(storeName, indexName, key, filter, count, skip);
}
function add(databaseName, storeName, data, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].add(storeName, data, key);
}
function put(databaseName, storeName, data, key) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].put(storeName, data, key);
}
function deleteRecord(databaseName, storeName, id) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].delete(storeName, id);
}
function batchAdd(databaseName, storeName, data) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].batchAdd(storeName, data);
}
function batchPut(databaseName, storeName, data) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].batchPut(storeName, data);
}
function batchDelete(databaseName, storeName, ids) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].batchDelete(storeName, ids);
}
function clearStore(databaseName, storeName) {
    ensureDatabaseInstance(databaseName);
    return instanceManager[databaseName].clearStore(storeName);
}
function ensureDatabaseInstance(databaseName) {
    if (!instanceManager[databaseName]) {
        createInstance(databaseName);
    }
}
class IndexedDbManager {
    static E_DB_CLOSED = "Database is closed";
    dbInstance = undefined;
    databaseName = "";
    constructor() { }
    open = async (database) => {
        var upgradeError = "";
        try {
            if (!this.dbInstance || this.dbInstance.version < database.version) {
                if (this.dbInstance) {
                    this.dbInstance.close();
                    this.dbInstance = undefined;
                }
                this.dbInstance = await (0,idb__WEBPACK_IMPORTED_MODULE_0__.openDB)(database.name, database.version, {
                    upgrade(db, oldVersion, newVersion, transaction) {
                        try {
                            IndexedDbManager.upgradeDatabase(db, oldVersion, newVersion, transaction, database);
                        }
                        catch (error) {
                            upgradeError = error instanceof Error ? error.message : String(error);
                            throw (error);
                        }
                    },
                });
            }
            return true;
        }
        catch (error) {
            throw (error instanceof Error ? error.message : String(error)) + ' ' + upgradeError;
        }
        return false;
    };
    close = () => {
        try {
            this.dbInstance?.close();
            this.dbInstance = undefined;
        }
        catch (error) {
            throw error instanceof Error ? error.message : String(error);
        }
    };
    deleteDatabase = async () => {
        try {
            this.close();
            await (0,idb__WEBPACK_IMPORTED_MODULE_0__.deleteDB)(this.databaseName);
        }
        catch (error) {
            throw `Database ${this.databaseName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    clearObjectStore = async (storeName) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const transaction = this.dbInstance.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            await store.clear();
            console.log(`Cleared object store: ${storeName}`);
        }
        catch (error) {
            throw `Failed to clear object store ${storeName} in database ${this.databaseName}: ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getDbSchema = async () => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const dbInstance = this.dbInstance;
            const dbInfo = {
                name: dbInstance.name,
                version: dbInstance.version,
                objectStores: []
            };
            for (let s = 0; s < dbInstance.objectStoreNames.length; s++) {
                let dbStore = dbInstance.transaction(dbInstance.objectStoreNames[s], 'readonly').store;
                let objectStore = {
                    name: dbStore.name,
                    keyPath: Array.isArray(dbStore.keyPath) ? dbStore.keyPath.join(',') : dbStore.keyPath,
                    autoIncrement: dbStore.autoIncrement,
                    indexes: []
                };
                for (let i = 0; i < dbStore.indexNames.length; i++) {
                    const dbIndex = dbStore.index(dbStore.indexNames[i]);
                    let index = {
                        name: dbIndex.name,
                        keyPath: Array.isArray(dbIndex.keyPath) ? dbIndex.keyPath.join(',') : dbIndex.keyPath,
                        multiEntry: dbIndex.multiEntry,
                        unique: dbIndex.unique
                    };
                    objectStore.indexes.push(index);
                }
                dbInfo.objectStores.push(objectStore);
            }
            return dbInfo;
        }
        catch (error) {
            throw `Database ${this.databaseName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    count = async (storeName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let result = await tx.store.count(key ?? undefined);
            await tx.done;
            return result;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    countByKeyRange = async (storeName, lower, upper, lowerOpen, upperOpen) => {
        try {
            return await this.count(storeName, IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen));
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    get = async (storeName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let result = await tx.store.get(key);
            await tx.done;
            return result;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAll = async (storeName, key, count) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let results = await tx.store.getAll(key ?? undefined, count ?? undefined);
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllByKeyRange = async (storeName, lower, upper, lowerOpen, upperOpen, count) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            return await this.getAll(storeName, IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen), count);
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllByArrayKey = async (storeName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let results = [];
            for (let index = 0; index < key.length; index++) {
                const element = key[index];
                results = results.concat(await tx.store.getAll(element));
            }
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getKey = async (storeName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let result = await tx.store.getKey(key);
            await tx.done;
            return result;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllKeys = async (storeName, key, count) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let results = await tx.store.getAllKeys(key ?? undefined, count ?? undefined);
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllKeysByKeyRange = async (storeName, lower, upper, lowerOpen, upperOpen, count) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            return await this.getAllKeys(storeName, IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen), count);
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllKeysByArrayKey = async (storeName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let results = [];
            for (let index = 0; index < key.length; index++) {
                const element = key[index];
                results = results.concat(await tx.store.getAllKeys(element));
            }
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    query = async (storeName, key, filter, count = 0, skip = 0) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            try {
                var func = new Function('obj', filter);
            }
            catch (error) {
                throw `${error instanceof Error ? error.message : String(error)} in filter { ${filter} }`;
            }
            var row = 0;
            var errorMessage = "";
            let results = [];
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let cursor = await tx.store.openCursor(key ?? undefined);
            while (cursor) {
                if (!cursor) {
                    return;
                }
                try {
                    var out = func(cursor.value);
                    if (out) {
                        row++;
                        if (row > skip) {
                            results.push(out);
                        }
                    }
                }
                catch (error) {
                    errorMessage = `obj: ${JSON.stringify(cursor.value)}\nfilter: ${filter}\nerror: ${error instanceof Error ? error.message : String(error)}`;
                    return;
                }
                if (count > 0 && results.length >= count) {
                    return;
                }
                cursor = await cursor.continue();
            }
            await tx.done;
            if (errorMessage) {
                throw errorMessage;
            }
            return results;
        }
        catch (error) {
            throw `Store ${storeName} ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    countFromIndex = async (storeName, indexName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let result = await tx.store.index(indexName).count(key ?? undefined);
            await tx.done;
            return result;
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    countFromIndexByKeyRange = async (storeName, indexName, lower, upper, lowerOpen, upperOpen) => {
        try {
            return await this.countFromIndex(storeName, indexName, IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen));
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getFromIndex = async (storeName, indexName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            const results = await tx.store.index(indexName).get(key);
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllFromIndex = async (storeName, indexName, key, count) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            const results = await tx.store.index(indexName).getAll(key ?? undefined, count ?? undefined);
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllFromIndexByKeyRange = async (storeName, indexName, lower, upper, lowerOpen, upperOpen, count) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            return await this.getAllFromIndex(storeName, indexName, IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen), count);
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllFromIndexByArrayKey = async (storeName, indexName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            const dx = tx.store.index(indexName);
            let results = [];
            for (let index = 0; index < key.length; index++) {
                const element = key[index];
                results = results.concat(await dx.getAll(element));
            }
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getKeyFromIndex = async (storeName, indexName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            const results = await tx.store.index(indexName).getKey(key);
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllKeysFromIndex = async (storeName, indexName, key, count) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            const results = await tx.store.index(indexName).getAllKeys(key ?? undefined, count ?? undefined);
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllKeysFromIndexByKeyRange = async (storeName, indexName, lower, upper, lowerOpen, upperOpen, count) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            return await this.getAllKeysFromIndex(storeName, indexName, IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen), count);
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    getAllKeysFromIndexByArrayKey = async (storeName, indexName, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            const dx = tx.store.index(indexName);
            let results = [];
            for (let index = 0; index < key.length; index++) {
                const element = key[index];
                results = results.concat(await dx.getAllKeys(element));
            }
            await tx.done;
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    queryFromIndex = async (storeName, indexName, key, filter, count = 0, skip = 0) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            try {
                var func = new Function('obj', filter);
            }
            catch (error) {
                throw `${error instanceof Error ? error.message : String(error)} in filter { ${filter} }`;
            }
            var row = 0;
            var errorMessage = "";
            let results = [];
            const tx = this.dbInstance.transaction(storeName, 'readonly');
            let cursor = await tx.store.index(indexName).openCursor(key ?? undefined);
            while (cursor) {
                if (!cursor) {
                    return;
                }
                try {
                    var out = func(cursor.value);
                    if (out) {
                        row++;
                        if (row > skip) {
                            results.push(out);
                        }
                    }
                }
                catch (error) {
                    errorMessage = `obj: ${JSON.stringify(cursor.value)}\nfilter: ${filter}\nerror: ${error instanceof Error ? error.message : String(error)}`;
                    return;
                }
                if (count > 0 && results.length >= count) {
                    return;
                }
                cursor = await cursor.continue();
            }
            await tx.done;
            if (errorMessage) {
                throw errorMessage;
            }
            return results;
        }
        catch (error) {
            throw `Store ${storeName}, Index ${indexName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    add = async (storeName, data, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readwrite');
            data = this.checkForKeyPath(tx.store, data);
            const result = await tx.store.add(data, key ?? undefined);
            await tx.done;
            return result;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    put = async (storeName, data, key) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readwrite');
            const result = await tx.store.put(data, key ?? undefined);
            await tx.done;
            return result;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    delete = async (storeName, id) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readwrite');
            await tx.store.delete(id);
            await tx.done;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    batchAdd = async (storeName, data) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readwrite');
            let result = [];
            data.forEach(async (element) => {
                let item = this.checkForKeyPath(tx.store, element);
                result.push(await tx.store.add(item));
            });
            await tx.done;
            return result;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    batchPut = async (storeName, data) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readwrite');
            let result = [];
            data.forEach(async (element) => {
                result.push(await tx.store.put(element));
            });
            await tx.done;
            return result;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    batchDelete = async (storeName, ids) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readwrite');
            ids.forEach(async (element) => {
                await tx.store.delete(element);
            });
            await tx.done;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    clearStore = async (storeName) => {
        try {
            if (!this.dbInstance)
                throw IndexedDbManager.E_DB_CLOSED;
            const tx = this.dbInstance.transaction(storeName, 'readwrite');
            await tx.store.clear();
            await tx.done;
        }
        catch (error) {
            throw `Store ${storeName}, ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    checkForKeyPath(objectStore, data) {
        if (!objectStore.autoIncrement || !objectStore.keyPath) {
            return data;
        }
        if (typeof objectStore.keyPath !== 'string') {
            return data;
        }
        const keyPath = objectStore.keyPath;
        if (!data[keyPath]) {
            delete data[keyPath];
        }
        return data;
    }
    static upgradeDatabase(upgradeDB, oldVersion, newVersion, transaction, dbDatabase) {
        if (newVersion && newVersion > oldVersion) {
            if (dbDatabase.objectStores) {
                for (var store of dbDatabase.objectStores) {
                    if (!upgradeDB.objectStoreNames.contains(store.name)) {
                        this.addNewStore(upgradeDB, store);
                    }
                    else {
                        this.updateExistingStore(upgradeDB, transaction, store);
                    }
                }
            }
        }
    }
    static getKeyPath(keyPath) {
        if (keyPath) {
            var multiKeyPath = keyPath.split(',');
            return multiKeyPath.length > 1 ? multiKeyPath : keyPath;
        }
        else {
            return undefined;
        }
    }
    static updateExistingStore(upgradeDB, transaction, store) {
        try {
            const existingStore = transaction.objectStore(store.name);
            for (var index of store.indexes) {
                if (!existingStore.indexNames.contains(index.name)) {
                    try {
                        existingStore.createIndex(index.name, this.getKeyPath(index.keyPath) ?? index.name, {
                            multiEntry: index.multiEntry,
                            unique: index.unique
                        });
                    }
                    catch (error) {
                        throw `index ${index.name}, ${error instanceof Error ? error.message : String(error)}`;
                    }
                }
            }
        }
        catch (error) {
            throw `updating store ${store.name}, ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    static addNewStore(upgradeDB, store) {
        try {
            const newStore = upgradeDB.createObjectStore(store.name, {
                keyPath: this.getKeyPath(store.keyPath),
                autoIncrement: store.autoIncrement
            });
            for (var index of store.indexes) {
                try {
                    newStore.createIndex(index.name, this.getKeyPath(index.keyPath) ?? index.name, {
                        multiEntry: index.multiEntry,
                        unique: index.unique
                    });
                }
                catch (error) {
                    throw `index ${index.name}, ${error instanceof Error ? error.message : String(error)}`;
                }
            }
        }
        catch (error) {
            throw `store ${store.name}, ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

})();

const __webpack_exports__IndexedDbManager = __webpack_exports__.IndexedDbManager;
const __webpack_exports__add = __webpack_exports__.add;
const __webpack_exports__batchAdd = __webpack_exports__.batchAdd;
const __webpack_exports__batchDelete = __webpack_exports__.batchDelete;
const __webpack_exports__batchPut = __webpack_exports__.batchPut;
const __webpack_exports__clearIndexedDbObjectStore = __webpack_exports__.clearIndexedDbObjectStore;
const __webpack_exports__clearStore = __webpack_exports__.clearStore;
const __webpack_exports__closeDatabase = __webpack_exports__.closeDatabase;
const __webpack_exports__count = __webpack_exports__.count;
const __webpack_exports__countByKeyRange = __webpack_exports__.countByKeyRange;
const __webpack_exports__countFromIndex = __webpack_exports__.countFromIndex;
const __webpack_exports__countFromIndexByKeyRange = __webpack_exports__.countFromIndexByKeyRange;
const __webpack_exports__createInstance = __webpack_exports__.createInstance;
const __webpack_exports__deleteDatabase = __webpack_exports__.deleteDatabase;
const __webpack_exports__deleteRecord = __webpack_exports__.deleteRecord;
const __webpack_exports__get = __webpack_exports__.get;
const __webpack_exports__getAll = __webpack_exports__.getAll;
const __webpack_exports__getAllByArrayKey = __webpack_exports__.getAllByArrayKey;
const __webpack_exports__getAllByKeyRange = __webpack_exports__.getAllByKeyRange;
const __webpack_exports__getAllFromIndex = __webpack_exports__.getAllFromIndex;
const __webpack_exports__getAllFromIndexByArrayKey = __webpack_exports__.getAllFromIndexByArrayKey;
const __webpack_exports__getAllFromIndexByKeyRange = __webpack_exports__.getAllFromIndexByKeyRange;
const __webpack_exports__getAllKeys = __webpack_exports__.getAllKeys;
const __webpack_exports__getAllKeysByArrayKey = __webpack_exports__.getAllKeysByArrayKey;
const __webpack_exports__getAllKeysByKeyRange = __webpack_exports__.getAllKeysByKeyRange;
const __webpack_exports__getAllKeysFromIndex = __webpack_exports__.getAllKeysFromIndex;
const __webpack_exports__getAllKeysFromIndexByArrayKey = __webpack_exports__.getAllKeysFromIndexByArrayKey;
const __webpack_exports__getAllKeysFromIndexByKeyRange = __webpack_exports__.getAllKeysFromIndexByKeyRange;
const __webpack_exports__getDbSchema = __webpack_exports__.getDbSchema;
const __webpack_exports__getFromIndex = __webpack_exports__.getFromIndex;
const __webpack_exports__getKey = __webpack_exports__.getKey;
const __webpack_exports__getKeyFromIndex = __webpack_exports__.getKeyFromIndex;
const __webpack_exports__openDatabase = __webpack_exports__.openDatabase;
const __webpack_exports__put = __webpack_exports__.put;
const __webpack_exports__query = __webpack_exports__.query;
const __webpack_exports__queryFromIndex = __webpack_exports__.queryFromIndex;
export { __webpack_exports__IndexedDbManager as IndexedDbManager, __webpack_exports__add as add, __webpack_exports__batchAdd as batchAdd, __webpack_exports__batchDelete as batchDelete, __webpack_exports__batchPut as batchPut, __webpack_exports__clearIndexedDbObjectStore as clearIndexedDbObjectStore, __webpack_exports__clearStore as clearStore, __webpack_exports__closeDatabase as closeDatabase, __webpack_exports__count as count, __webpack_exports__countByKeyRange as countByKeyRange, __webpack_exports__countFromIndex as countFromIndex, __webpack_exports__countFromIndexByKeyRange as countFromIndexByKeyRange, __webpack_exports__createInstance as createInstance, __webpack_exports__deleteDatabase as deleteDatabase, __webpack_exports__deleteRecord as deleteRecord, __webpack_exports__get as get, __webpack_exports__getAll as getAll, __webpack_exports__getAllByArrayKey as getAllByArrayKey, __webpack_exports__getAllByKeyRange as getAllByKeyRange, __webpack_exports__getAllFromIndex as getAllFromIndex, __webpack_exports__getAllFromIndexByArrayKey as getAllFromIndexByArrayKey, __webpack_exports__getAllFromIndexByKeyRange as getAllFromIndexByKeyRange, __webpack_exports__getAllKeys as getAllKeys, __webpack_exports__getAllKeysByArrayKey as getAllKeysByArrayKey, __webpack_exports__getAllKeysByKeyRange as getAllKeysByKeyRange, __webpack_exports__getAllKeysFromIndex as getAllKeysFromIndex, __webpack_exports__getAllKeysFromIndexByArrayKey as getAllKeysFromIndexByArrayKey, __webpack_exports__getAllKeysFromIndexByKeyRange as getAllKeysFromIndexByKeyRange, __webpack_exports__getDbSchema as getDbSchema, __webpack_exports__getFromIndex as getFromIndex, __webpack_exports__getKey as getKey, __webpack_exports__getKeyFromIndex as getKeyFromIndex, __webpack_exports__openDatabase as openDatabase, __webpack_exports__put as put, __webpack_exports__query as query, __webpack_exports__queryFromIndex as queryFromIndex };

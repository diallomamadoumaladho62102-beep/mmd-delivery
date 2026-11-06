var wrappy = require('wrappy')
var once = require('once')

// SNYK-JS-INFLIGHT-6095116 / CWE-772
// Upstream 1.0.6 deletes a slot only when the returned function runs.
// A dropped function left its callbacks in `reqs` for the life of the process.
// FinalizationRegistry releases that slot when nothing still references the
// function. glob@7 still receives null when it joins an in-flight key, and
// still receives a function it must call to finish the request.
var reqs = Object.create(null)
var seq = 0
var registry = typeof FinalizationRegistry === 'function'
	? new FinalizationRegistry(function (held) {
		var slot = reqs[held.key]
		if (slot && slot.id === held.id) delete reqs[held.key]
	})
	: null

module.exports = wrappy(inflight)

function inflight (key, cb) {
	if (reqs[key]) {
		reqs[key].cbs.push(cb)
		return null
	}

	var id = ++seq
	reqs[key] = { cbs: [cb], id: id }
	var ret = makeres(key, id)
	if (registry) registry.register(ret, { key: key, id: id })
	return ret
}

function makeres (key, id) {
	return once(function RES () {
		var slot = reqs[key]
		if (!slot || slot.id !== id) return
		var cbs = slot.cbs
		var len = cbs.length
		var args = slice(arguments)

		try {
			for (var i = 0; i < len; i++) {
				cbs[i].apply(null, args)
			}
		} finally {
			if (cbs.length > len) {
				cbs.splice(0, len)
				process.nextTick(function () {
					RES.apply(null, args)
				})
			} else if (reqs[key] && reqs[key].id === id) {
				delete reqs[key]
			}
		}
	})
}

function slice (args) {
	var length = args.length
	var array = []

	for (var i = 0; i < length; i++) array[i] = args[i]
	return array
}

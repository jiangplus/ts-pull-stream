
type Err = null | boolean | string

interface Callback {
    (err: Err, data?: any): void;
}

interface Sourcefn {
    (err: Err, callback?: Callback): void;
}

interface Sinkfn {
    (source: Sourcefn): void;
}

type Throughfn = { source: Sourcefn, sink: Sinkfn }

type Pullfn = Sourcefn | Sinkfn | Throughfn

interface abortfn {
    (err: Err): void;
}

interface fn {
    <T>(arg: T): T;
}


function abortCb(cb: Callback, abort: Err, onAbort?: abortfn) {
  cb(abort)
  onAbort && onAbort(abort === true ? null: abort)
  return
}

function values<T> (array: T[], onAbort?: abortfn) {
  if(!array)
    return function (abort: Err, cb: Callback) {
      if(abort) return abortCb(cb, abort, onAbort)
      return cb(true)
    }
  if(!Array.isArray(array))
    array = Object.keys(array).map(function (k) {
      return array[k]
    })
  var i = 0
  return function (abort: Err, cb: Callback) {
    if(abort)
      return abortCb(cb, abort, onAbort)
    if(i >= array.length)
      cb(true)
    else
      cb(null, array[i++])
  }
}

function id<T> (e: T): T { return e }

function prop (key: string | RegExp): any {
  return key && (
    'string' == typeof key
    ? function (data: any): any { return data[key] }
    : 'object' === typeof key && 'function' === typeof key.exec //regexp
    ? function (data: string): string | null { var v = key.exec(data); return v && v[0] }
    : key
  )
}

function asyncMap<T> (map: (data: T, cb: Callback) => void): any {
  if(!map) return id
  map = prop(<any>map)
  var busy = false, abortCb: abortfn, aborted: Err
  return function (read: Sourcefn) {
    return function next (abort: Err, cb: Callback) {
      if(aborted) return cb(aborted)
      if(abort) {
        aborted = abort
        if(!busy) read(abort, function (err: Err) {
          //incase the source has already ended normally,
          //we should pass our own error.
          cb(abort)
        })
        else read(abort, function (err: Err) {
          //if we are still busy, wait for the mapper to complete.
          if(busy) abortCb = cb
          else cb(abort)
        })
      }
      else
        read(null, function (end: Err, data?: any) {
          if(end) cb(end)
          else if(aborted) cb(aborted)
          else {
            busy = true
            map(data, function (err: Err, data?: any) {
              busy = false
              if(aborted) {
                cb(aborted)
                abortCb && abortCb(aborted)
              }
              else if(err) next (err, cb)
              else cb(null, data)
            })
          }
        })
    }
  }
}


function drain<T> (op: ((item: T) => boolean | void), done: (err: Err) => void): Sinkfn {
  var read: Sourcefn, abort: Err

  function sink (_read: Sourcefn): any {
    read = _read
    if(abort) return local_abort()
    //this function is much simpler to write if you
    //just use recursion, but by using a while loop
    //we do not blow the stack if the stream happens to be sync.
    ;(function next() {
        var loop = true, cbed = false
        while(loop) {
          cbed = false
          read(null, function (end, data) {
            cbed = true
            if(end = end || abort) {
              loop = false
              if(done) done(end === true ? null : end)
              else if(end && end !== true)
                throw end
            }
            else if(op && false === op(data) || abort) {
              loop = false
              read(abort || true, done || function () {})
            }
            else if(!loop){
              next()
            }
          })
          if(!cbed) {
            loop = false
            return
          }
        }
      })()
  }

  function local_abort (err?: Err, cb?: Callback): void {
    if('function' == typeof err)
      cb = err, err = true
    abort = err || true
    if(read) return read(abort, cb || function () {})
  }

  return sink
}


function reduce<T, U> (reducer: (acc: T,item: U) => T, acc0: T|Callback, cb0?: Callback) {
  var acc: T|null, cb: Callback
  if(!cb0) {
    cb = <Callback> acc0
    acc = null
  } else {
    cb = <Callback> cb0
    acc = <T> acc0
  }
  var sink = drain(function (data) {
    acc = reducer(<T> acc, <U> data)
  }, function (err: Err) {
    cb(err, acc)
  })
  if (arguments.length === 2)
    return function (source: Sourcefn) {
      source(null, function (end: Err, data?: any) {
        //if ended immediately, and no initial...
        if(end) return cb(end === true ? null : end)
        acc = data; sink(source)
      })
    }
  else
    return sink
}

// ((acc: T,item: U) => T, T, Callback) => void
function collect<T> (cb: Callback) {
  return reduce(function (arr: T[], item: T): T[] {
    arr.push(item)
    return arr
  }, [], cb)
}

var fs = require('fs')

function pull (...rest: Array<any>) {
  var length = arguments.length
  var a: any = arguments[0]
  if (typeof a === 'function' && a.length === 1) {
    var args: Array<any> | null = new Array(length)
    for(var i = 0; i < length; i++)
      args[i] = arguments[i]
    return function (read: Sourcefn) {
      if (args == null) {
        throw new TypeError("partial sink should only be called once!")
      }

      // Grab the reference after the check, because it's always an array now
      // (engines like that kind of consistency).
      var ref: Array<any> = args
      args = null

      // Prioritize common case of small number of pulls.
      switch (length) {
      case 1: return pull(read, ref[0])
      case 2: return pull(read, ref[0], ref[1])
      case 3: return pull(read, ref[0], ref[1], ref[2])
      case 4: return pull(read, ref[0], ref[1], ref[2], ref[3])
      default:
        ref.unshift(read)
        return pull.apply(null, ref)
      }
    }
  }

  var read: any = a

  if (read && typeof read.source === 'function') {
    read = read.source
  }

  for (var i = 1; i < length; i++) {
    var s = arguments[i]
    if (typeof s === 'function') {
      read = s(read)
    } else if (s && typeof s === 'object') {
      s.sink(read)
      read = s.source
    }
  }

  return read
}


pull(
  values<String>(['package.json', 'example.js']),
  asyncMap(fs.stat),
  collect(function (err, array) {
    console.log(array)
  })
)